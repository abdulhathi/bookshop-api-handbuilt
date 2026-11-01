import { describe, expect, it } from 'vitest';
import { ALLOWED_ORIGIN, AUTH, BASE, built, call, claims, json, problem, SECRETS, signJwt, token, uniqueKey } from './http';

const tokenRequest = (form: Record<string, string>, basic?: [string, string]) =>
  fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(basic ? { authorization: `Basic ${Buffer.from(basic.join(':')).toString('base64')}` } : {}),
    },
    body: new URLSearchParams(form),
  });

describe('10 · Authentication', () => {
  it('answers 401 with a Bearer challenge when there is no token', async () => {
    const res = await call('/v1/products');
    await problem(res, 401, 'unauthorized', '/v1/products');
    const challenge = res.headers.get('www-authenticate') ?? '';
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain('realm="api-concepts"');
    expect(challenge).not.toContain('error=');
  });

  it('rejects expired, wrongly signed, wrong-audience and unsigned tokens', async () => {
    const now = Math.floor(Date.now() / 1000);
    const bad = [
      signJwt(claims({ iat: now - 1000, exp: now - 60 })),
      signJwt(claims(), 'some-other-secret-that-is-long-enough-123'),
      signJwt(claims({ aud: 'someone-else' })),
      signJwt(claims({ iss: 'someone-else' })),
      signJwt(claims(), undefined, 'none'),
      'not-a-jwt',
    ];
    for (const t of bad) {
      const res = await call('/v1/products', { token: t });
      await problem(res, 401, 'unauthorized');
      expect(res.headers.get('www-authenticate') ?? '').toContain('error="invalid_token"');
    }
  });

  it('accepts any correctly signed token, because the JWT is self-contained', async () => {
    const res = await call('/v1/echo', { token: signJwt(claims()) });
    expect(res.status).toBe(200);
  });
});

describe('11 · Authorization', () => {
  it('answers 403 with insufficient_scope when the scope is missing', async () => {
    const res = await call('/v1/products', {
      method: 'POST',
      token: await token('reader'),
      body: { title: 'Nope', author: 'A', priceCents: 1 },
    });
    await problem(res, 403, 'forbidden');
    const challenge = res.headers.get('www-authenticate') ?? '';
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain('scope="products:write"');
  });

  it.skipIf(!built(22))("hides another client's order behind a 404, but admin can see it", async () => {
    const created = await json('/v1/orders', {
      method: 'POST',
      token: await token('writer'),
      headers: { 'idempotency-key': uniqueKey() },
      body: { items: [{ productId: 'prd_01', quantity: 1 }] },
    });
    expect(created.res.status).toBe(201);
    const path = `/v1/orders/${created.body.id}`;
    await problem(await call(path, { token: await token('partner') }), 404, 'not-found', path);
    await problem(await call(`${path}/pay`, { method: 'POST', token: await token('partner') }), 404, 'not-found');
    expect((await call(path, { token: await token('admin') })).status).toBe(200);
    expect((await call(path, { token: await token('writer') })).status).toBe(200);
  });

  it.skipIf(!built(22))("lists only the caller's own orders", async () => {
    const { body } = await json('/v1/orders?limit=50', { token: await token('partner') });
    for (const order of body.data) expect(order.clientId).toBe('partner');
  });
});

describe('12 · Access tokens and JWT', () => {
  it.skipIf(AUTH !== 'oauth')('issues an HS256 JWT with the expected claims', async () => {
    const t = await token('writer');
    const [head, payload] = t.split('.').slice(0, 2).map((p) => JSON.parse(Buffer.from(p, 'base64url').toString() || 'null'));
    expect(head).toMatchObject({ alg: 'HS256', typ: 'JWT' });
    expect(payload).toMatchObject({
      iss: 'api-concepts',
      aud: 'api-concepts-clients',
      sub: 'writer',
      scope: 'products:read products:write orders:read orders:write',
    });
    expect(payload.exp - payload.iat).toBe(900);
    expect(payload.jti).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('describes the caller at /v1/me', async () => {
    // Uses reader, not free: the rate-limit test may have emptied the free plan's bucket already.
    const { body } = await json('/v1/me', { token: await token('reader') });
    expect(body).toMatchObject({ clientId: 'reader', scopes: ['products:read', 'orders:read'], plan: 'standard' });
    expect(Date.parse(body.tokenExpiresAt)).toBeGreaterThan(Date.now());
  });
});

describe('13 · OAuth 2.0 client credentials', () => {
  it('accepts client_secret_basic and client_secret_post, never cached', async () => {
    const basic = await tokenRequest({ grant_type: 'client_credentials' }, ['reader', SECRETS.reader]);
    expect(basic.status).toBe(200);
    expect(basic.headers.get('cache-control')).toContain('no-store');
    expect(await basic.json()).toMatchObject({ token_type: 'Bearer', expires_in: 900, scope: 'products:read orders:read' });

    const post = await tokenRequest({ grant_type: 'client_credentials', client_id: 'reader', client_secret: SECRETS.reader });
    expect(post.status).toBe(200);
  });

  it('narrows the token to the requested scope', async () => {
    const res = await tokenRequest({ grant_type: 'client_credentials', scope: 'products:read' }, ['reader', SECRETS.reader]);
    const body = await res.json();
    expect(body.scope).toBe('products:read');
    expect((await call('/v1/products', { token: body.access_token })).status).toBe(200);
    await problem(await call('/v1/orders', { token: body.access_token }), 403, 'forbidden');
  });

  it('returns RFC 6749 errors', async () => {
    const wrongSecret = await tokenRequest({ grant_type: 'client_credentials' }, ['reader', 'wrong']);
    expect(wrongSecret.status).toBe(401);
    expect(wrongSecret.headers.get('www-authenticate') ?? '').toMatch(/^Basic /);
    expect((await wrongSecret.json()).error).toBe('invalid_client');

    const grant = await tokenRequest({ grant_type: 'password' }, ['reader', SECRETS.reader]);
    expect(grant.status).toBe(400);
    expect((await grant.json()).error).toBe('unsupported_grant_type');

    const scope = await tokenRequest({ grant_type: 'client_credentials', scope: 'admin' }, ['reader', SECRETS.reader]);
    expect(scope.status).toBe(400);
    expect((await scope.json()).error).toBe('invalid_scope');
  });
});

describe('14 · HTTPS', () => {
  it('sends HSTS only when the request came over HTTPS', async () => {
    const tls = await call('/health', { headers: { 'x-forwarded-proto': 'https' } });
    expect(tls.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
    const plain = await call('/health');
    expect(plain.headers.get('strict-transport-security')).toBeNull();
  });
});

describe('15 · CORS', () => {
  it('answers a preflight from an allowed origin without a token', async () => {
    const res = await call('/v1/products', {
      method: 'OPTIONS',
      headers: {
        origin: ALLOWED_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type, idempotency-key',
      },
    });
    expect([200, 204]).toContain(res.status);
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    const methods = (res.headers.get('access-control-allow-methods') ?? '').toUpperCase();
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) expect(methods).toContain(m);
    const headers = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase();
    for (const h of ['authorization', 'content-type', 'idempotency-key']) expect(headers).toContain(h);
    expect(res.headers.get('access-control-max-age')).toBe('600');
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('exposes the useful response headers to an allowed origin', async () => {
    const res = await call('/v1/products/prd_01', { token: await token('reader'), headers: { origin: ALLOWED_ORIGIN } });
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    expect((res.headers.get('vary') ?? '').toLowerCase()).toContain('origin');
    const exposed = (res.headers.get('access-control-expose-headers') ?? '').toLowerCase();
    for (const h of ['etag', 'link', 'location', 'retry-after', 'ratelimit-remaining', 'x-request-id', 'idempotent-replayed']) {
      expect(exposed).toContain(h);
    }
  });

  it('gives a disallowed origin nothing', async () => {
    const res = await call('/v1/products', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
