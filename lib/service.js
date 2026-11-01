import { randomUUID } from 'node:crypto'
import { fail } from './errors.js'
import { normalizeConnection, normalizeSettings, passwordInput, targetKey, integer } from './validation.js'

function identifier(value, field) {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\x00-\x1f]/.test(value)) fail('VALIDATION', `Invalid ${field}.`)
  return value // Quoted identifiers can contain significant leading/trailing spaces.
}
export class DatabaseService {
  constructor(store, vault, runner) { this.store = store; this.vault = vault; this.runner = runner; this.tasks = new Map(); this.epochs = new Map(); this.runtimeEpoch = 0 }
  stamp(id) { return `${this.runtimeEpoch}:${this.epochs.get(id) || 0}` }
  invalidate(id) { this.epochs.set(id, (this.epochs.get(id) || 0) + 1); this.cancel(id) }
  public(c) {
    const { credential, ...profile } = c
    return { ...profile, hasPassword: this.vault.has(credential), credentialPersistent: credential?.kind === 'windows-dpapi' }
  }
  find(state, id) {
    const c = state.connections.find(c => c.id === id)
    if (!c) fail('NOT_FOUND', 'Connection not found. Refresh the connection list.')
    return c
  }
  cancel(id) { for (const task of this.tasks.get(id) || []) task.abort(); this.tasks.delete(id) }
  async action(r, { source = 'user', signal } = {}) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) fail('VALIDATION', 'Invalid request.')
    const admittedStamp = this.stamp(r.id)
    const agent = source === 'agent'
    if (agent && !['list', 'test', 'schemas', 'tables', 'columns', 'indexes'].includes(r.op)) fail('USER_ONLY', 'This operation requires the database panel.')
    if (r.op === 'list') {
      const state = await this.store.read()
      if (agent) return { connections: state.connections.filter(c => c.agentEnabled).map(({ id, name, type, revision }) => ({ id, name, type, revision })) }
      return { connections: state.connections.map(c => this.public(c)), settings: state.settings, credentialStorage: this.vault.storage }
    }
    if (r.op === 'save') {
      const input = r.connection, normalized = normalizeConnection(input), password = passwordInput(r.password)
      let fresh, old
      try {
        const result = await this.store.mutate(async state => {
          const previous = input.id ? this.find(state, input.id) : undefined
          if (previous && input.revision !== previous.revision) fail('CONFLICT', 'Connection changed in another panel. Refresh before saving.')
          if (!previous && state.connections.length >= 200) fail('LIMIT', 'At most 200 connections are supported.')
          if (previous?.credential && targetKey(previous) !== targetKey(normalized) && !password && normalized.type !== 'sqlite') fail('PASSWORD_REQUIRED', 'Connection target changed. Enter its password again.')
          const c = { ...normalized, id: previous?.id || randomUUID(), revision: (previous?.revision || 0) + 1, updatedAt: new Date().toISOString() }
          if (c.type !== 'sqlite') c.credential = password !== undefined ? (fresh = await this.vault.protect(password)) : previous?.credential
          if (previous?.credential !== c.credential) old = previous?.credential
          if (previous) state.connections[state.connections.indexOf(previous)] = c
          else state.connections.push(c)
          return this.public(c)
        })
        this.invalidate(result.id)
        this.vault.forget(old)
        return result
      } catch (e) { this.vault.forget(fresh); throw e }
    }
    if (r.op === 'delete') {
      let old
      const result = await this.store.mutate(state => {
        const c = this.find(state, r.id)
        if (r.revision !== c.revision) fail('CONFLICT', 'Connection changed. Refresh before deleting.')
        state.connections.splice(state.connections.indexOf(c), 1); old = c.credential
        return { deleted: true }
      })
      this.invalidate(r.id); this.vault.forget(old)
      return result
    }
    if (r.op === 'settings') {
      const removed = []
      const result = await this.store.mutate(state => {
        const settings = normalizeSettings(r.settings)
        if (settings.pythonPath !== state.settings.pythonPath) {
          for (const c of state.connections) { removed.push(c.credential); delete c.credential; c.agentEnabled = false; c.revision++ }
        }
        state.settings = settings
        return settings
      })
      this.runtimeEpoch++
      for (const id of this.tasks.keys()) this.cancel(id)
      for (const record of removed) this.vault.forget(record)
      return result
    }
    const state = await this.store.read()
    if (r.op === 'diagnostics') return this.runner.database(state.settings, { action: 'diagnostics' }, signal)
    if (!['test', 'schemas', 'tables', 'columns', 'indexes'].includes(r.op)) fail('VALIDATION', 'Unknown operation.')
    const c = this.find(state, r.id)
    if (agent && !c.agentEnabled) fail('ACCESS_DENIED', 'Enable this connection for the assistant in the database panel first.')
    const request = { action: r.op, connection: { ...normalizeConnection(c), id: c.id } }
    if (r.schema !== undefined && r.schema !== '') request.schema = identifier(r.schema, 'schema')
    if (r.op === 'columns' || r.op === 'indexes') request.table = identifier(r.table, 'table')
    request.limit = integer(r.limit ?? 100, 'limit', 1, 200)
    request.offset = integer(r.offset ?? 0, 'offset', 0, 100000)
    const controller = new AbortController(), abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) controller.abort()
    const running = this.tasks.get(c.id) || new Set()
    running.add(controller); this.tasks.set(c.id, running)
    try {
      request.connection.password = c.type === 'sqlite' ? '' : await this.vault.reveal(c.credential)
      // Check both persistent revision (other Host instances) and local generation
      // (updates that happened while this request awaited file/credential I/O).
      const current = this.find(await this.store.read(), c.id)
      if (this.stamp(c.id) !== admittedStamp || current.revision !== c.revision || (agent && !current.agentEnabled)) fail('CONNECTION_CHANGED', 'Connection changed before execution. Retry with the current configuration.')
      if (controller.signal.aborted) fail('CANCELLED', 'Operation cancelled.')
      const result = await this.runner.database(state.settings, request, controller.signal)
      const latest = this.find(await this.store.read(), c.id)
      if (this.stamp(c.id) !== admittedStamp || latest.revision !== c.revision || (agent && !latest.agentEnabled)) fail('CONNECTION_CHANGED', 'Connection changed during the request. Retry with the current configuration.')
      return result
    } finally {
      request.connection.password = ''
      signal?.removeEventListener('abort', abort)
      running.delete(controller)
      if (!running.size && this.tasks.get(c.id) === running) this.tasks.delete(c.id)
    }
  }
  dispose() { this.runtimeEpoch++; for (const id of this.tasks.keys()) this.cancel(id); this.vault.dispose(); this.runner.dispose() }
}
