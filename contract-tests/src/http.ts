import { createHmac } from 'node:crypto';
import { expect } from 'vitest';

/** The server under test. `run.sh` sets API_URL (not BASE_URL, which Vite reserves); the default is the Python stack. */
export const BASE = (process.env.API_URL ?? 'http://127.0.0.1:8001').replace(/\/$/, '');
export const DEV_SECRET = process.env.JWT_SECRET ?? 'dev-only-secret-change-me-0123456789abcdef';
export const ALLOWED_ORIGIN = 'http://localhost:5173';
export const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const SECRETS: Record<string, string> = {
  reader: 'reader-secret',
  writer: 'writer-secret',
  partner: 'partner-secret',
  admin: 'admin-secret',
  free: 'free-secret',
};

type Options = {
  method?: string;
  token?: string;
  headers?: Record<string, string>;
  /** Sent as JSON unless it is already a string. */
  body?: unknown;
};

export async function call(path: string, { method = 'GET', token, headers = {}, body }: Options = {}) {
  const h: Record<string, string> = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  let payload: string | undefined;
  if (body !== undefined) {
    payload = typeof body === 'string' ? body : JSON.stringify(body);
    h['content-type'] ??= 'application/json';
  }
  return fetch(`${BASE}${path}`, { method, headers: h, body: payload });
}

/** Calls and parses the JSON body (null for an empty body). */
export async function json(path: string, options: Options = {}) {
  const res = await call(path, options);
  const text = await res.text();
  return { res, body: text ? JSON.parse(text) : null };
}

/**
 * How the suite gets its tokens. A server built from scratch, one concept at a time, can be tested before it has
 * every piece of security (the hand-built track sets this in check.sh):
 *   oauth (default)  from the server's POST /oauth/token, as SPEC.md says
 *   local            the suite signs the JWT itself: the server checks tokens but has no token endpoint yet
 *   off              a placeholder: the server does not check tokens yet
 */
export const AUTH = (process.env.CONTRACT_AUTH ?? 'oauth') as 'oauth' | 'local' | 'off';

/** The concepts the server has built (CONTRACT_BUILT=1,2,3). Unset means all of them. */
const BUILT = process.env.CONTRACT_BUILT?.split(',').map((n) => Number(n.trim()));
export const built = (concept: number) => !BUILT || BUILT.includes(concept);

const SCOPES: Record<string, string> = {
  reader: 'products:read orders:read',
  writer: 'products:read products:write orders:read orders:write',
  partner: 'products:read products:write orders:read orders:write',
  admin: 'products:read products:write orders:read orders:write admin',
  free: 'products:read',
};

/** Client-credentials token, sent with HTTP Basic. Cached per client and scope. */
const tokens = new Map<string, string>();
export async function token(client: string, scope?: string): Promise<string> {
  if (AUTH === 'off') return `not-checked-yet-${client}`;
  if (AUTH === 'local') return signJwt(claims({ sub: client, scope: scope ?? SCOPES[client], exp: Math.floor(Date.now() / 1000) + 900 }));
  const key = `${client} ${scope ?? ''}`;
  const cached = tokens.get(key);
  if (cached) return cached;
  const form = new URLSearchParams({ grant_type: 'client_credentials' });
  if (scope) form.set('scope', scope);
  const res = await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${client}:${SECRETS[client]}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
  expect(res.status, `token for ${client}`).toBe(200);
  const body = await res.json();
  tokens.set(key, body.access_token);
  return body.access_token;
}

/** Asserts an RFC 9457 problem with the spec's slug, and returns its body. */
/** One title per problem type, the same in every stack (SPEC.md, Errors). */
export const TITLES: Record<string, string> = {
  'validation-error': 'Your request is not valid',
  'malformed-json': 'The request body is not valid JSON',
  'invalid-cursor': 'The pagination cursor is not valid',
  'idempotency-key-required': 'An Idempotency-Key header is required',
  'unauthorized': 'Authentication is required',
  'forbidden': 'You are not allowed to do this',
  'not-found': 'Resource not found',
  'method-not-allowed': 'Method not allowed',
  'invalid-state': 'The resource is in a state that does not allow this',
  'idempotency-key-in-progress': 'A request with this Idempotency-Key is in progress',
  'precondition-failed': 'The resource changed since you last saw it',
  'unsupported-media-type': 'Unsupported media type',
  'unknown-product': 'The order references an unknown product',
  'idempotency-key-reused': 'This Idempotency-Key was used with a different request',
  'rate-limited': 'Too many requests',
  'internal-error': 'Internal server error',
  'throttled': 'The server is busy',
  'service-unavailable': 'The service is temporarily unavailable',
  'timeout': 'The request took too long',
};

export async function problem(res: Response, status: number, slug: string, path?: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get('content-type') ?? '').toContain('application/problem+json');
  const body = await res.json();
  expect(body.type).toBe(`/problems/${slug}`);
  expect(body.status).toBe(status);
  expect(body.title).toBe(TITLES[slug]);
  expect(body.requestId).toBe(res.headers.get('x-request-id'));
  if (path) expect(body.instance).toBe(path);
  return body;
}

/** Signs a JWT the way the servers do, so tests can forge expired or wrongly signed tokens. */
export function signJwt(claims: Record<string, unknown>, secret = DEV_SECRET, alg = 'HS256') {
  const part = (x: unknown) => Buffer.from(JSON.stringify(x)).toString('base64url');
  const head = `${part({ alg, typ: 'JWT' })}.${part(claims)}`;
  const sig = alg === 'none' ? '' : createHmac('sha256', secret).update(head).digest('base64url');
  return `${head}.${sig}`;
}

export function claims(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: 'api-concepts',
    aud: 'api-concepts-clients',
    sub: 'reader',
    scope: 'products:read orders:read',
    iat: now,
    exp: now + 300,
    jti: crypto.randomUUID(),
    ...overrides,
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A unique, valid idempotency key or demo key. */
export const uniqueKey = () => crypto.randomUUID();
