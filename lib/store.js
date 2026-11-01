import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fail } from './errors.js'
import { normalizeConnection, normalizeSettings } from './validation.js'
const initial = () => ({ version: 1, settings: { pythonPath: '', timeoutSeconds: 30 }, connections: [] })
function validate(state) {
  if (state?.version !== 1 || !Array.isArray(state.connections) || state.connections.length > 200) throw new Error('Invalid store')
  normalizeSettings(state.settings)
  const ids = new Set()
  for (const c of state.connections) {
    normalizeConnection(c)
    if (typeof c.id !== 'string' || !/^[0-9a-f-]{36}$/.test(c.id) || ids.has(c.id) || !Number.isSafeInteger(c.revision) || c.revision < 1) throw new Error('Invalid connection')
    ids.add(c.id)
    if (c.credential && (!['windows-dpapi', 'session-only'].includes(c.credential.kind) || typeof c.credential.value !== 'string')) throw new Error('Invalid credential')
  }
  return state
}
export class Store {
  constructor(directory) { this.directory = directory; this.file = path.join(directory, 'connections.json'); this.queue = Promise.resolve() }
  async read() {
    try { return validate(JSON.parse(await fs.readFile(this.file, 'utf8'))) }
    catch (error) {
      if (error.code === 'ENOENT') {
        try { await fs.access(this.file + '.bak') } catch (backupError) { if (backupError.code === 'ENOENT') return initial() }
      }
      // Never silently overwrite damaged configuration or revive stale grants.
      fail('STORE_DAMAGED', 'Connection store is unreadable. Restore its .bak copy before saving; no data was overwritten.')
    }
  }
  mutate(fn) {
    const operation = this.queue.catch(() => {}).then(async () => {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
      const lockFile = path.join(this.directory, 'write.lock')
      let lock
      try { lock = await fs.open(lockFile, 'wx', 0o600) }
      catch (e) { if (e.code === 'EEXIST') fail('STORE_BUSY', 'Another instance is saving. If no DSH instance is running, remove the stale write.lock file.'); throw e }
      let tmp
      try {
        const state = await this.read()
        const result = await fn(state)
        validate(state)
        tmp = this.file + '.' + randomUUID() + '.tmp'
        const data = JSON.stringify(state, null, 2) + '\n'
        const handle = await fs.open(tmp, 'wx', 0o600)
        try { await handle.writeFile(data, 'utf8'); await handle.sync() } finally { await handle.close() }
        try { await fs.copyFile(this.file, this.file + '.bak') } catch (e) { if (e.code !== 'ENOENT') throw e }
        await fs.rename(tmp, this.file)
        tmp = undefined
        return result
      } finally {
        if (tmp) await fs.unlink(tmp).catch(() => {})
        await lock.close()
        await fs.unlink(lockFile).catch(() => {})
      }
    })
    this.queue = operation
    return operation
  }
}
