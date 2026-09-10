export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function httpError(statusCode: number, code: string, message: string): HttpError {
  return new HttpError(statusCode, code, message);
}
