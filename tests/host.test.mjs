import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Store } from '../lib/store.js'
import { Vault } from '../lib/vault.js'
import { ProcessRunner } from '../lib/runner.js'
import { DatabaseService } from '../lib/service.js'
import { createHandler, definitions } from '../lib/index.js'

async function fixture(t, runner = { database: async (_s, r) => ({ action: r.action, items: [], hasMore: false }), dispose() {} }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-db-test-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const store = new Store(dir), vault = new Vault(runner, 'linux'), service = new DatabaseService(store, vault, runner)
  return { dir, store, vault, service }
}
const input = () => ({ name: 'Test DB', type: 'postgresql', host: '127.0.0.1', database: 'demo', username: 'reader', port: 5432 })
const save = (s, connection = input(), password = 'private-password') => s.action({ op: 'save', connection, password })

test('public profiles, tool list and persisted file never contain plaintext password', async t => {
  const { service, store, dir } = await fixture(t)
  const c = await save(service)
  assert.equal(c.hasPassword, true)
  assert.equal(c.credentialPersistent, false)
  assert.equal(JSON.stringify(await service.action({ op: 'list' })).includes('private-password'), false)
  assert.equal((await fs.readFile(store.file, 'utf8')).includes('private-password'), false)
  assert.deepEqual(await service.action({ op: 'list' }, { source: 'agent' }), { connections: [] })
  await assert.rejects(service.action({ op: 'test', id: c.id }, { source: 'agent' }), { code: 'ACCESS_DENIED' })
  await assert.rejects(service.action({ op: 'save', connection: input() }, { source: 'agent' }), { code: 'USER_ONLY' })
  const granted = await save(service, { ...c, agentEnabled: true }, '')
  const listed = await service.action({ op: 'list' }, { source: 'agent' })
  assert.deepEqual(Object.keys(listed.connections[0]).sort(), ['id', 'name', 'revision', 'type'])
  assert.equal((await service.action({ op: 'schemas', id: granted.id }, { source: 'agent' })).action, 'schemas')
  const restarted = new DatabaseService(new Store(dir), new Vault({}, 'linux'), {})
  assert.equal((await restarted.action({ op: 'list' })).connections[0].hasPassword, false)
})

test('target changes require password, conflicts prevent stale overwrite; rename preserves credential', async t => {
  const { service } = await fixture(t)
  const c = await save(service)
  await assert.rejects(save(service, { ...c, host: 'other.example' }, ''), { code: 'PASSWORD_REQUIRED' })
  await assert.rejects(save(service, { ...c, tlsMode: 'disable' }, ''), { code: 'PASSWORD_REQUIRED' })
  const renamed = await save(service, { ...c, name: 'New label' }, '')
  assert.equal(renamed.hasPassword, true)
  assert.equal(renamed.revision, 2)
  await assert.rejects(save(service, c), { code: 'CONFLICT' })
  await assert.rejects(service.action({ op: 'delete', id: c.id, revision: c.revision }), { code: 'CONFLICT' })
  await service.action({ op: 'delete', id: c.id, revision: renamed.revision })
  assert.equal((await service.action({ op: 'list' })).connections.length, 0)
})

test('host rejects malformed fields and executable changes clear old secrets and grants', async t => {
  const { service } = await fixture(t)
  for (const override of [{ host: 'a)(HOST=evil)' }, { port: 70000 }, { name: '' }, { type: 'unknown' }]) {
    await assert.rejects(save(service, { ...input(), ...override }), { code: 'VALIDATION' })
  }
  await save(service, { ...input(), agentEnabled: true })
  await service.action({ op: 'settings', settings: { pythonPath: path.join(os.tmpdir(), 'new-python.exe'), timeoutSeconds: 30 } })
  const c = (await service.action({ op: 'list' })).connections[0]
  assert.equal(c.hasPassword, false)
  assert.equal(c.agentEnabled, false)
  assert.equal(c.revision, 2)
})

test('serialized writes, backup, cross-instance lock and corrupt-store protection', async t => {
  const { service, store, dir } = await fixture(t)
  await Promise.all(Array.from({ length: 8 }, (_, i) => save(service, { ...input(), name: 'DB ' + i })))
  assert.equal((await store.read()).connections.length, 8)
  assert.equal(JSON.parse(await fs.readFile(store.file + '.bak', 'utf8')).connections.length, 7)
  const lock = path.join(dir, 'write.lock')
  await fs.writeFile(lock, '')
  await assert.rejects(save(service), { code: 'STORE_BUSY' })
  await fs.unlink(lock)
  await fs.writeFile(store.file, '{bad')
  await assert.rejects(save(service), { code: 'STORE_DAMAGED' })
  assert.equal(await fs.readFile(store.file, 'utf8'), '{bad')
})

test('revoking metadata access cancels work and never releases stale results', async t => {
  let start, release
  const started = new Promise(r => { start = r })
  const pending = new Promise(r => { release = r })
  let requestSignal
  const { service } = await fixture(t, { database: async (_s, _r, signal) => { requestSignal = signal; start(); return pending }, dispose() {} })
  const c = await save(service, { ...input(), agentEnabled: true })
  const result = service.action({ op: 'tables', id: c.id }, { source: 'agent' })
  await started
  await save(service, { ...c, agentEnabled: false }, '')
  assert.equal(requestSignal.aborted, true)
  release({ items: [{ name: 'private_table' }] })
  await assert.rejects(result, { code: 'CONNECTION_CHANGED' })
})

test('route bounds input, rejects malformed content, never reflects raw exceptions', async t => {
  const { service } = await fixture(t)
  const handler = createHandler(service)
  const request = body => new Request('http://localhost/api/dsh-db-connect/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
  assert.equal((await (await handler(request('{'))).json()).error.code, 'VALIDATION')
  assert.equal((await (await handler(request(' '.repeat(65537)))).json()).error.code, 'INPUT_TOO_LARGE')
  const result = await handler(request(JSON.stringify({ op: 'save', connection: input(), password: 'hidden' })))
  assert.equal((await result.json()).ok, true)
  assert.equal(result.headers.get('cache-control'), 'no-store')
  const failure = createHandler({ action: async () => { throw new Error('secret-host password') } })
  const text = await (await failure(request('{}'))).text()
  assert.equal(text.includes('secret-host'), false)
  const tools = definitions(x => x, service)
  assert.deepEqual(tools.map(x => x.name), ['db_connections', 'db_inspect'])
  assert.equal(JSON.stringify(tools.map(x => x.parameters)).includes('password'), false)
})

test('requests holding an old snapshot never launch after access is revoked', async t => {
  let calls = 0, ready, release
  const started = new Promise(r => { ready = r }), gate = new Promise(r => { release = r })
  const { service, store } = await fixture(t, { database: async () => { calls++; return {} }, dispose() {} })
  const c = await save(service, { ...input(), agentEnabled: true })
  const original = store.read.bind(store)
  let block = true
  store.read = async () => { const snapshot = await original(); if (block) { block = false; ready(); await gate } return snapshot }
  const request = service.action({ op: 'tables', id: c.id }, { source: 'agent' })
  await started
  await save(service, { ...c, agentEnabled: false }, '')
  release()
  await assert.rejects(request, { code: 'CONNECTION_CHANGED' })
  assert.equal(calls, 0)
})

test('superseded session passwords are erased and failed commits leave no secret', async t => {
  const { service, vault, store } = await fixture(t)
  const c = await save(service)
  assert.equal(vault.memory.size, 1)
  const next = await save(service, c, 'new-secret')
  assert.equal(vault.memory.size, 1)
  assert.deepEqual([...vault.memory.values()], ['new-secret'])
  await service.action({ op: 'delete', id: next.id, revision: next.revision })
  assert.equal(vault.memory.size, 0)
  store.mutate = async fn => { await fn({ version: 1, settings: {}, connections: [] }); throw new Error('disk failure') }
  await assert.rejects(save(service))
  assert.equal(vault.memory.size, 0)
})

test('metadata identifiers retain significant whitespace', async t => {
  let captured
  const { service } = await fixture(t, { database: async (_s, r) => { captured = r; return {} }, dispose() {} })
  const c = await save(service)
  await service.action({ op: 'columns', id: c.id, schema: ' quoted schema ', table: ' table ' })
  assert.equal(captured.schema, ' quoted schema ')
  assert.equal(captured.table, ' table ')
})

const python = process.env.DSH_DB_TEST_PYTHON

test('real worker protocol, SQLite read-only metadata and runtime diagnostics', { skip: !python }, async t => {
  const runner = new ProcessRunner(); t.after(() => runner.dispose())
  const { service, dir } = await fixture(t, runner)
  const database = path.join(dir, 'sample.sqlite')
  await runner.json(python, ['-B', '-c', 'import json,sqlite3,sys;r=json.load(sys.stdin);c=sqlite3.connect(r["path"]);c.execute("CREATE TABLE sample (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");c.close();print(json.dumps({"ok":True,"value":True}))'], { path: database })
  await service.action({ op: 'settings', settings: { pythonPath: python, timeoutSeconds: 15 } })
  const c = await save(service, { name: 'Local sample', type: 'sqlite', sqlitePath: database, agentEnabled: true }, '')
  const value = await service.action({ op: 'columns', id: c.id, schema: 'main', table: 'sample' }, { source: 'agent' })
  assert.equal(value.items[1].name, 'name')
  assert.equal(value.items[1].nullable, false)
  assert.equal((await service.action({ op: 'test', id: c.id })).connected, true)
  const diag = await service.action({ op: 'diagnostics' })
  assert.equal(diag.drivers.sqlite3.available, true)
  assert.equal((await service.action({ op: 'schemas', id: c.id })).items[0].name, 'main')
})

test('runner timeout, abort, output cap and disposal', { skip: !python }, async t => {
  const runner = new ProcessRunner(); t.after(() => runner.dispose())
  await assert.rejects(runner.json(python, ['-c', 'import time;time.sleep(10)'], {}, { timeoutMs: 100 }), { code: 'TIMEOUT' })
  const controller = new AbortController()
  const work = runner.json(python, ['-c', 'import time;time.sleep(10)'], {}, { signal: controller.signal })
  controller.abort()
  await assert.rejects(work, { code: 'CANCELLED' })
  await assert.rejects(runner.json(python, ['-c', 'print("x"*3000000)'], {}), { code: 'OUTPUT_TOO_LARGE' })
  runner.dispose()
  await assert.rejects(runner.json(python, [], {}), { code: 'CANCELLED' })
})

test('Windows DPAPI round trip hides Unicode password at rest', { skip: process.platform !== 'win32' }, async t => {
  const runner = new ProcessRunner(); t.after(() => runner.dispose())
  const vault = new Vault(runner)
  const secret = '密码 $ test\" \\ spaces '
  const record = await vault.protect(secret)
  assert.equal(record.kind, 'windows-dpapi')
  assert.equal(record.value.includes(secret), false)
  assert.equal(await vault.reveal(record), secret)
})
