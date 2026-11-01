import path from 'node:path'
import { fail } from './errors.js'
export const TYPES = ['oracle', 'postgresql', 'mysql', 'mariadb', 'sqlserver', 'sqlite']
export const PORTS = { oracle: 1521, postgresql: 5432, mysql: 3306, mariadb: 3306, sqlserver: 1433, sqlite: 1 }
export function text(value, field, max = 256, required = false) {
  if (value === undefined || value === null) value = ''
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f]/.test(value)) fail('VALIDATION', `Invalid ${field}.`)
  value = value.trim()
  if (required && !value) fail('VALIDATION', `${field} is required.`)
  return value
}
export function integer(value, field, min, max) {
  if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value)
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('VALIDATION', `Invalid ${field}.`)
  return value
}
function choice(value, field, allowed, fallback) {
  value = value || fallback
  if (!allowed.includes(value)) fail('VALIDATION', `Invalid ${field}.`)
  return value
}
export function normalizeConnection(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('VALIDATION', 'Connection must be an object.')
  const type = choice(raw.type, 'type', TYPES, 'oracle')
  const c = {
    name: text(raw.name, 'name', 120, true), type,
    host: type === 'sqlite' ? '' : text(raw.host, 'host', 253, true),
    port: type === 'sqlite' ? 1 : integer(raw.port || PORTS[type], 'port', 1, 65535),
    database: type === 'sqlite' ? '' : text(raw.database, 'database', 256, true),
    username: type === 'sqlite' ? '' : text(raw.username, 'username', 256, true),
    oracleMode: choice(raw.oracleMode, 'oracleMode', ['thick', 'thin'], 'thick'),
    connectBy: choice(raw.connectBy, 'connectBy', ['service', 'sid'], 'service'),
    clientDir: type === 'oracle' ? text(raw.clientDir, 'clientDir', 4096) : '',
    sqlitePath: type === 'sqlite' ? text(raw.sqlitePath, 'sqlitePath', 4096, true) : '',
    tlsMode: choice(raw.tlsMode, 'tlsMode', ['verify', 'disable'], 'verify'),
    agentEnabled: raw.agentEnabled === true,
  }
  if (c.host && /[\s/\\;=()]/.test(c.host)) fail('VALIDATION', 'Host must be a hostname or IP address, not a connection string.')
  if (c.type === 'oracle' && /[()=\r\n]/.test(c.database)) fail('VALIDATION', 'Enter a service name or SID, not an Oracle descriptor.')
  if (c.sqlitePath && !path.isAbsolute(c.sqlitePath)) fail('VALIDATION', 'SQLite requires an absolute file path.')
  if (c.clientDir && !path.isAbsolute(c.clientDir)) fail('VALIDATION', 'Oracle client directory must be absolute.')
  return c
}
export function targetKey(c) {
  return JSON.stringify([c.type, c.host.toLowerCase(), c.port, c.database, c.username, c.oracleMode, c.connectBy, c.clientDir, c.sqlitePath, c.tlsMode])
}
export function normalizeSettings(raw) {
  if (!raw || typeof raw !== 'object') fail('VALIDATION', 'Invalid runtime settings.')
  const pythonPath = text(raw.pythonPath, 'pythonPath', 4096)
  if (pythonPath && !path.isAbsolute(pythonPath)) fail('VALIDATION', 'Python executable must be an absolute path.')
  return { pythonPath, timeoutSeconds: integer(raw.timeoutSeconds ?? 30, 'timeoutSeconds', 5, 120) }
}
export function passwordInput(value) {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || value.length > 4096 || value.includes('\0')) fail('VALIDATION', 'Invalid password.')
  return value
}
