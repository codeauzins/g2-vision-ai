/** Safe fields from thrown errors (no image bytes, no API keys). */
export function publicError(err: unknown): Record<string, unknown> {
  if (err == null) return { message: 'unknown' };
  if (typeof err !== 'object') return { message: String(err) };

  const e = err as {
    name?: string;
    message?: string;
    status?: number;
    statusCode?: number;
    code?: string;
    type?: string;
    requestID?: string;
    request_id?: string;
    error?: { message?: string; type?: string; code?: string; param?: string };
  };

  return {
    name: e.name,
    message: e.message,
    status: e.status ?? e.statusCode,
    code: e.code,
    type: e.type,
    openaiType: e.error?.type,
    openaiCode: e.error?.code,
    openaiMessage: e.error?.message,
    openaiParam: e.error?.param,
    requestId: e.requestID || e.request_id,
  };
}
