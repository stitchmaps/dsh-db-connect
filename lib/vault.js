import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { fail } from './errors.js'
export class Vault {
  constructor(runner, platform = process.platform) { this.runner = runner; this.platform = platform; this.memory = new Map() }
  get storage() { return this.platform === 'win32' ? 'windows-dpapi' : 'session-only' }
  async crypt(op, value) {
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    return this.runner.json(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('../scripts/credential.ps1', import.meta.url))], { op, value }, { timeoutMs: 10000 })
  }
  async protect(password) {
    if (this.platform === 'win32') return { kind: 'windows-dpapi', value: await this.crypt('protect', password) }
    const key = randomUUID(); this.memory.set(key, password)
    return { kind: 'session-only', value: key }
  }
  has(record) { return !!record && (record.kind === 'windows-dpapi' || this.memory.has(record.value)) }
  async reveal(record) {
    if (!record) return ''
    if (record.kind === 'windows-dpapi' && this.platform === 'win32') return this.crypt('unprotect', record.value)
    if (record.kind === 'session-only' && this.memory.has(record.value)) return this.memory.get(record.value)
    fail('CREDENTIAL_REQUIRED', 'Enter the password again in the database panel.')
  }
  forget(record) { if (record?.kind === 'session-only') this.memory.delete(record.value) }
  dispose() { this.memory.clear() }
}
