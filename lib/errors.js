export class StudioError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export function invariant(ok, code, message) {
  if (!ok) throw new StudioError(code, message);
}
