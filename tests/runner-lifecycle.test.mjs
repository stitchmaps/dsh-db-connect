import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { ProcessRunner } from '../lib/runner.js'

function fixture() {
  const children = []
  const runner = new ProcessRunner(() => {
    const child = new EventEmitter()
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.kills = []
    child.kill = signal => { child.kills.push(signal); return true }
    children.push(child)
    return child
  })
  return { runner, children }
}
function observe(promise) {
  const state = { settled: false }
  state.done = promise.then(value => { state.settled = true; state.value = value }, error => { state.settled = true; state.error = error })
  return state
}
const tick = () => new Promise(resolve => setImmediate(resolve))

test('abort waits for close, retains capacity, and ignores late success', async () => {
  const { runner, children } = fixture()
  const controller = new AbortController()
  const pending = observe(runner.json('fake', [], {}, { signal: controller.signal }))
  const child = children[0]
  controller.abort()
  await tick()
  assert.deepEqual(child.kills, ['SIGKILL'])
  assert.equal(pending.settled, false)
  assert.equal(runner.active.size, 1)
  child.stdout.emit('data', Buffer.from('{"ok":true,"value":"late"}'))
  child.emit('close', 0)
  await pending.done
  assert.equal(pending.error.code, 'CANCELLED')
  assert.equal(runner.active.size, 0)
})

test('timeout force kills and waits for terminal close', async () => {
  const { runner, children } = fixture()
  const pending = observe(runner.json('fake', [], {}, { timeoutMs: 5 }))
  await new Promise(resolve => setTimeout(resolve, 15))
  assert.deepEqual(children[0].kills, ['SIGKILL'])
  assert.equal(pending.settled, false)
  children[0].emit('close', null)
  await pending.done
  assert.equal(pending.error.code, 'TIMEOUT')
})

test('dispose cancels all processes without untracking and prevents new workers', async () => {
  const { runner, children } = fixture()
  const pending = [observe(runner.json('fake', [], {})), observe(runner.json('fake', [], {}))]
  runner.dispose()
  runner.dispose()
  assert.equal(runner.active.size, 2)
  await assert.rejects(runner.json('fake', [], {}), { code: 'CANCELLED' })
  assert.equal(children.length, 2)
  for (const child of children) {
    assert.deepEqual(child.kills, ['SIGKILL'])
    child.emit('close', 0)
  }
  await Promise.all(pending.map(p => p.done))
  assert.ok(pending.every(p => p.error.code === 'CANCELLED'))
  assert.equal(runner.active.size, 0)
  assert.equal(runner.cancellations.size, 0)
})

test('cancellation with failed kill retains each slot until close', async () => {
  const { runner, children } = fixture()
  const controllers = Array.from({ length: 4 }, () => new AbortController())
  const pending = controllers.map(c => observe(runner.json('fake', [], {}, { signal: c.signal })))
  children[0].kill = () => false
  children[1].kill = () => { throw new Error('sensitive process details') }
  controllers.forEach(c => c.abort())
  await tick()
  assert.equal(runner.active.size, 4)
  assert.ok(pending.every(p => !p.settled))
  await assert.rejects(runner.json('fake', [], {}), { code: 'BUSY' })
  children.forEach(c => c.emit('close', 1))
  await Promise.all(pending.map(p => p.done))
  assert.ok(pending.every(p => p.error.code === 'CANCELLED' && !p.error.message.includes('sensitive')))
})

test('spawn failures are sanitized and asynchronous failure drains close', async () => {
  const runner = new ProcessRunner(() => { throw new Error('secret executable') })
  await assert.rejects(runner.json('fake', [], {}), e => e.code === 'RUNTIME_UNAVAILABLE' && !e.message.includes('secret'))
  assert.equal(runner.active.size, 0)
  const { runner: other, children } = fixture()
  const pending = observe(other.json('fake', [], {}))
  children[0].emit('error', new Error('secret spawn details'))
  await tick()
  assert.equal(pending.settled, false)
  assert.equal(other.active.size, 1)
  children[0].emit('close', -2)
  await pending.done
  assert.equal(pending.error.code, 'RUNTIME_UNAVAILABLE')
  assert.ok(!pending.error.message.includes('secret'))
})

test('input stream failure is redacted and drains close', async () => {
  const { runner, children } = fixture()
  const pending = observe(runner.json('fake', [], { password: 'secret' }))
  children[0].stdin.emit('error', new Error('secret EPIPE'))
  await tick()
  assert.equal(pending.settled, false)
  children[0].emit('close', 1)
  await pending.done
  assert.equal(pending.error.code, 'WORKER_FAILED')
  assert.ok(!pending.error.message.includes('secret'))
})

test('output overflow kills and prevents late success', async () => {
  const { runner, children } = fixture()
  const pending = observe(runner.json('fake', [], {}))
  children[0].stdout.emit('data', Buffer.alloc(2 * 1024 * 1024 + 1))
  assert.equal(runner.active.size, 1)
  children[0].stdout.emit('data', Buffer.from('{"ok":true,"value":1}'))
  children[0].emit('close', 0)
  await pending.done
  assert.equal(pending.error.code, 'OUTPUT_TOO_LARGE')
})

test('success releases capacity and aborted inputs never spawn', async () => {
  const { runner, children } = fixture()
  const pending = runner.json('fake', [], {})
  children[0].stdout.emit('data', Buffer.from('{"ok":true,"value":{"connected":true}}'))
  children[0].emit('close', 0)
  assert.deepEqual(await pending, { connected: true })
  assert.equal(runner.active.size, 0)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(runner.json('fake', [], {}, { signal: controller.signal }), { code: 'CANCELLED' })
  assert.equal(children.length, 1)
  const circular = {}; circular.self = circular
  await assert.rejects(runner.json('fake', [], circular), { code: 'INVALID_REQUEST' })
})

test('real child is force terminated on abort before rejection settles', async () => {
  const runner = new ProcessRunner()
  const controller = new AbortController()
  const pending = observe(runner.json(process.execPath, ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'], {}, { signal: controller.signal }))
  const child = [...runner.active][0]
  let closed = false
  child.on('close', () => { closed = true })
  controller.abort()
  await pending.done
  assert.equal(pending.error.code, 'CANCELLED')
  assert.equal(closed, true)
  assert.equal(runner.active.size, 0)
})
