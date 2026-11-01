import { describe, expect, it } from 'vitest';
import { AUTH, built, call, json, problem, TIMESTAMP, token } from './http';

describe('1 · Requests and responses', () => {
  it('echoes the method, path, query, headers and body it received', async () => {
    const t = await token('reader');
    const { res, body } = await json('/v1/echo?q=hello&page=2', { token: t, headers: { 'x-demo': 'yes' } });
    expect(res.status).toBe(200);
    expect(body.method).toBe('GET');
    expect(body.path).toBe('/v1/echo');
    expect(body.query).toMatchObject({ q: 'hello', page: '2' });
    expect(body.headers['x-demo']).toBe('yes');
    expect(body.headers.authorization).toBe('Bearer ***');
    expect(body.body).toBeNull();

    const posted = await json('/v1/echo', { method: 'POST', token: t, body: { hello: 'world', n: 1 } });
    expect(posted.body.method).toBe('POST');
    expect(posted.body.body).toEqual({ hello: 'world', n: 1 });
  });
});

describe('2 · Endpoints', () => {
  it('serves an index and a health check without a token', async () => {
    const index = await json('/');
    expect(index.res.status).toBe(200);
    expect(index.body).toMatchObject({ name: 'Bookshop API', docs: '/docs', openapi: '/openapi.json' });
    const health = await json('/health');
    expect(health.res.status).toBe(200);
    expect(health.body).toEqual({ status: 'ok' });
  });
});

describe('3 · HTTP methods', () => {
  it('creates, reads, replaces, patches and deletes a product', async () => {
    const writer = await token('writer');
    const created = await json('/v1/products', {
      method: 'POST',
      token: writer,
      body: { title: 'Methods Matter', author: 'Test Author', priceCents: 1500, tags: ['http'] },
    });
    expect(created.res.status).toBe(201);
    const id = created.body.id;
    expect(id).toMatch(/^prd_[0-9a-f]{12}$/);

    const got = await json(`/v1/products/${id}`, { token: writer });
    expect(got.body.title).toBe('Methods Matter');

    const put = await json(`/v1/products/${id}`, {
      method: 'PUT',
      token: writer,
      body: { title: 'Methods Matter 2e', author: 'Test Author', priceCents: 1700, tags: [] },
    });
    expect(put.res.status).toBe(200);
    expect(put.body).toMatchObject({ title: 'Methods Matter 2e', priceCents: 1700, tags: [], version: 2 });

    const patch = await json(`/v1/products/${id}`, { method: 'PATCH', token: writer, body: { priceCents: 1800 } });
    expect(patch.res.status).toBe(200);
    expect(patch.body).toMatchObject({ title: 'Methods Matter 2e', priceCents: 1800, version: 3 });

    const notAdmin = await call(`/v1/products/${id}`, { method: 'DELETE', token: writer });
    if (AUTH !== 'off') await problem(notAdmin, 403, 'forbidden');

    const del = await call(`/v1/products/${id}`, { method: 'DELETE', token: await token('admin') });
    expect(del.status).toBe(204);
    await problem(await call(`/v1/products/${id}`, { token: writer }), 404, 'not-found', `/v1/products/${id}`);
  });

  it('rejects a PUT that is missing fields', async () => {
    const writer = await token('writer');
    const created = await json('/v1/products', { method: 'POST', token: writer, body: { title: 'Put Me', author: 'A', priceCents: 1 } });
    const res = await call(`/v1/products/${created.body.id}`, { method: 'PUT', token: writer, body: { title: 'Only a title' } });
    await problem(res, 400, 'validation-error');
  });
});

describe('4 · Headers', () => {
  it('echoes a valid X-Request-Id and generates one otherwise, even on errors', async () => {
    const echoed = await call('/health', { headers: { 'x-request-id': 'trace-abc.123' } });
    expect(echoed.headers.get('x-request-id')).toBe('trace-abc.123');

    const generated = await call('/no/such/route', { headers: { 'x-request-id': 'bad id with spaces' } });
    expect(generated.headers.get('x-request-id')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    await problem(generated, 404, 'not-found', '/no/such/route');
  });

  it('sends security headers on every response', async () => {
    for (const res of [await call('/health'), await call('/v1/products')]) {
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    }
  });

  it('answers 415 when the body is not JSON', async () => {
    const res = await call('/v1/products', {
      method: 'POST',
      token: await token('writer'),
      headers: { 'content-type': 'text/plain' },
      body: 'title=Plain',
    });
    await problem(res, 415, 'unsupported-media-type');
  });

  it('accepts merge patch JSON on PATCH only', async () => {
    const res = await call('/v1/products', {
      method: 'POST',
      token: await token('writer'),
      headers: { 'content-type': 'application/merge-patch+json' },
      body: JSON.stringify({ title: 'Merge', author: 'A', priceCents: 1 }),
    });
    await problem(res, 415, 'unsupported-media-type');
  });

  it('defaults to Cache-Control: no-store for personal responses', async () => {
    const res = await call('/v1/echo', { token: await token('reader') });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('5 · Path and query parameters', () => {
  it('filters by tag', async () => {
    const { body } = await json('/v1/products?tag=reliability&limit=50', { token: await token('reader') });
    expect(body.data.map((p: { id: string }) => p.id)).toEqual(['prd_08', 'prd_09', 'prd_13', 'prd_23']);
  });

  it('rejects a limit outside 1–50 with field errors', async () => {
    const t = await token('reader');
    for (const limit of ['0', '51', 'ten']) {
      const body = await problem(await call(`/v1/products?limit=${limit}`, { token: t }), 400, 'validation-error', '/v1/products');
      expect(Array.isArray(body.errors) && body.errors.length).toBeTruthy();
      expect(JSON.stringify(body.errors)).toContain('limit');
    }
  });

  it('answers 404 for an unknown path id', async () => {
    await problem(await call('/v1/products/prd_nope', { token: await token('reader') }), 404, 'not-found', '/v1/products/prd_nope');
  });
});

describe('6 · Request bodies', () => {
  it('validates fields', async () => {
    const t = await token('writer');
    const bad = [
      { author: 'No Title', priceCents: 100 },
      { title: '   ', author: 'Blank Title', priceCents: 100 },
      { title: 'Negative', author: 'A', priceCents: -1 },
      { title: 'Fraction', author: 'A', priceCents: 10.5 },
      { title: 'Bad Tag', author: 'A', priceCents: 1, tags: ['Not Lower'] },
    ];
    for (const body of bad) {
      const p = await problem(await call('/v1/products', { method: 'POST', token: t, body }), 400, 'validation-error');
      expect(p.errors.length).toBeGreaterThan(0);
    }
  });

  it('answers 400 malformed-json for a broken body', async () => {
    const res = await call('/v1/products', { method: 'POST', token: await token('writer'), body: '{"title": "oops"' });
    await problem(res, 400, 'malformed-json');
  });
});

describe('7 · JSON and serialization', () => {
  it('uses camelCase, integer cents, UTC timestamps and UTF-8', async () => {
    const { body } = await json('/v1/products/prd_24', { token: await token('reader') });
    expect(body).toEqual({
      id: 'prd_24',
      title: 'Observability for APIs',
      author: 'Tomás Silva',
      priceCents: 4399,
      currency: 'USD',
      tags: ['operations'],
      version: 1,
      createdAt: '2026-01-01T00:23:00.000Z',
      updatedAt: '2026-01-01T00:23:00.000Z',
    });
    expect(body.createdAt).toMatch(TIMESTAMP);
  });

  it('keeps nullable fields as null instead of dropping them', async () => {
    const { body } = await json('/v1/products?tag=career', { token: await token('reader') });
    expect(body.page).toEqual({ limit: 10, nextCursor: null, hasMore: false });
  });
});

describe('8 · API schemas', () => {
  it('publishes an OpenAPI 3 document and a docs page', async () => {
    const { res, body } = await json('/openapi.json');
    expect(res.status).toBe(200);
    expect(String(body.openapi)).toMatch(/^3\./);
    const paths = Object.keys(body.paths);
    expect(paths).toContain('/v1/products');
    if (built(22)) expect(paths).toContain('/v1/orders');
    if (built(26)) expect(paths).toContain('/v1/webhooks');
    // The path parameter's name is the implementation's choice: {id}, {productId}, {product_id}.
    expect(paths.some((p) => /^\/v1\/products\/\{\w+\}$/.test(p))).toBe(true);
    const docs = await call('/docs');
    expect(docs.status).toBe(200);
    expect(docs.headers.get('content-type') ?? '').toContain('text/html');
  });
});

describe('9 · Status codes', () => {
  it('uses 201 with Location for a create and 204 for a delete', async () => {
    const created = await call('/v1/products', {
      method: 'POST',
      token: await token('writer'),
      body: { title: 'Status Codes', author: 'A', priceCents: 1 },
    });
    expect(created.status).toBe(201);
    const location = created.headers.get('location');
    const { id } = await created.json();
    expect(location).toBe(`/v1/products/${id}`);
    const del = await call(location!, { method: 'DELETE', token: await token('admin') });
    expect(del.status).toBe(204);
    expect(await del.text()).toBe('');
  });
});
