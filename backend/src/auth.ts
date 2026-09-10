import { timingSafeEqual, randomUUID } from 'node:crypto';

export function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim();
}

/** Token from Authorization, X-G2-Token, or Shortcut-friendly ?token= / form token. */
export function requestToken(input: {
  authorization?: string;
  xToken?: string;
  queryToken?: string;
}): string | undefined {
  return (
    bearerToken(input.authorization) ||
    normalizeSecret(input.xToken) ||
    normalizeSecret(input.queryToken)
  );
}

function normalizeSecret(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let trimmed = value.trim().replace(/^["']|["']$/g, '');
  const bearer = /^Bearer\s+(.+)$/i.exec(trimmed);
  if (bearer) trimmed = bearer[1].trim();
  return trimmed || undefined;
}

export function secretsEqual(expected: string, provided: string | undefined): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function newJobId(): string {
  return randomUUID();
}
