export class AppError extends Error {
  constructor(code, message) { super(message); this.code = code }
}
export function fail(code, message) { throw new AppError(code, message) }
export function errorResult(error) {
  return { ok: false, error: error instanceof AppError ? { code: error.code, message: error.message } : { code: 'INTERNAL_ERROR', message: 'Operation failed. Check local runtime and file permissions.' } }
}
