import type { LatestResponse } from './types.js';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export async function fetchLatest(
  apiBaseUrl: string,
  deviceSecret: string,
  signal?: AbortSignal,
): Promise<LatestResponse> {
  if (!apiBaseUrl) {
    throw new ApiError('Backend URL is not configured', 0);
  }
  if (!deviceSecret) {
    throw new ApiError('App authentication failed.', 401);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const res = await fetch(`${apiBaseUrl}/api/latest`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${deviceSecret}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new ApiError(`HTTP ${res.status}`, res.status);
    }
    const body = (await res.json()) as LatestResponse;
    if (typeof body !== 'object' || body == null) {
      throw new ApiError('Malformed result');
    }
    return body;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError('timeout', 503);
    }
    throw new ApiError(err instanceof Error ? err.message : 'network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
