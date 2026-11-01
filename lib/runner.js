import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppError, fail } from './errors.js'
const ROOT = fileURLToPath(new URL('../', import.meta.url))

// Every operation owns one bounded process; credentials are stdin-only.
export class ProcessRunner {
  constructor(spawnProcess = spawn) {
    this.spawnProcess = spawnProcess
    this.active = new Set()
    this.cancellations = new Map()
    this.disposed = false
  }
  async json(executable, args, input, { signal, timeoutMs = 30000 } = {}) {
    if (this.disposed || signal?.aborted) fail('CANCELLED', 'Operation cancelled.')
    if (this.active.size >= 4) fail('BUSY', 'Four database operations are already running. Try again shortly.')
    let payload
    try { payload = JSON.stringify(input) } catch { fail('INVALID_REQUEST', 'Request cannot be serialized.') }
    if (typeof payload !== 'string') fail('INVALID_REQUEST', 'Request cannot be serialized.')
    if (Buffer.byteLength(payload) > 1024 * 1024) fail('INPUT_TOO_LARGE', 'Request is too large.')
    return new Promise((resolve, reject) => {
      let child, timer, settled = false, terminalError, bytes = 0, output = []
      const finish = (error, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        if (child) {
          this.active.delete(child)
          this.cancellations.delete(child)
        }
        payload = undefined
        output = []
        error ? reject(error) : resolve(value)
      }
      const stop = (code, message) => {
        if (settled || terminalError) return
        terminalError = new AppError(code, message)
        clearTimeout(timer)
        output = []
        payload = undefined
        // Settlement and capacity release happen only on close, including when
        // kill reports false or throws. Never claim a still-live worker stopped.
        try { child?.stdin?.destroy() } catch {}
        try { child?.kill('SIGKILL') } catch {}
      }
      const abort = () => stop('CANCELLED', 'Operation cancelled.')
      try {
        child = this.spawnProcess(executable, args, { cwd: ROOT, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' } })
      } catch { finish(new AppError('RUNTIME_UNAVAILABLE', 'Cannot start the configured runtime.')); return }
      this.active.add(child)
      this.cancellations.set(child, abort)
      // Node emits close after a spawn error. Keep the slot until that event.
      child.on('error', () => stop('RUNTIME_UNAVAILABLE', 'Cannot start the configured runtime. Check its executable path.'))
      child.stdin.on('error', () => stop('WORKER_FAILED', 'Worker input channel closed.'))
      child.stdout.on('error', () => stop('WORKER_FAILED', 'Worker output channel closed.'))
      child.stdout.on('data', chunk => {
        if (settled || terminalError) return
        bytes += chunk.length
        if (bytes > 2 * 1024 * 1024) { stop('OUTPUT_TOO_LARGE', 'Worker output exceeded the limit.'); return }
        output.push(chunk)
      })
      child.once('close', code => {
        if (settled) return
        if (terminalError) { finish(terminalError); return }
        if (code !== 0) { finish(new AppError('WORKER_FAILED', 'Worker stopped unexpectedly. Run driver diagnostics.')); return }
        try {
          const result = JSON.parse(Buffer.concat(output).toString('utf8').replace(/^\uFEFF/, ''))
          if (!result || typeof result.ok !== 'boolean') throw new Error()
          if (!result.ok) {
            // Worker messages are authored strings, never raw driver exception text.
            finish(new AppError(result.error?.code || 'WORKER_FAILED', result.error?.message || 'Worker failed.'))
          } else finish(undefined, result.value)
        } catch { finish(new AppError('WORKER_PROTOCOL', 'Worker returned an invalid response.')) }
      })
      timer = setTimeout(() => stop('TIMEOUT', 'Operation timed out; its worker was terminated.'), timeoutMs)
      signal?.addEventListener('abort', abort, { once: true })
      if (this.disposed || signal?.aborted) { abort(); return }
      try { child.stdin.end(payload, 'utf8'); payload = undefined }
      catch { stop('WORKER_FAILED', 'Worker input channel closed.') }
    })
  }
  database(settings, request, signal) {
    const executable = settings.pythonPath || process.env.DSH_DB_PYTHON || (process.platform === 'win32' ? 'python.exe' : 'python3')
    return this.json(executable, ['-B', path.join(ROOT, 'python', 'worker.py')], request, { signal, timeoutMs: settings.timeoutSeconds * 1000 })
  }
  dispose() {
    this.disposed = true
    for (const cancel of this.cancellations.values()) cancel()
  }
}
