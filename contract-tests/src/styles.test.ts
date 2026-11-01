import { describe, expect, it } from 'vitest';
import { built, call, json, problem, token, uniqueKey } from './http';

const seedIds = Array.from({ length: 25 }, (_, i) => `prd_${String(i + 1).padStart(2, '0')}`);

const graphql = (t: string | undefined, query: string, variables?: Record<string, unknown>) =>
  json('/graphql', { method: 'POST', token: t, headers: { accept: 'application/json' }, body: { query, variables } });

describe('16 · REST', () => {
  it('names resources with nouns and links a created resource with Location', async () => {
    const writer = await token('writer');
    const created = await call('/v1/products', { method: 'POST', token: writer, body: { title: 'REST Basics', author: 'A', priceCents: 10 } });
    const location = created.headers.get('location')!;
    const again = await json(location, { token: writer });
    expect(again.res.status).toBe(200);
    expect(again.body.title).toBe('REST Basics');
    await call(location, { method: 'DELETE', token: await token('admin') });
  });
});

describe('17 · GraphQL', () => {
  it('pages products with a connection', async () => {
    const t = await token('reader');
    const q = 'query($after: String) { products(first: 2, after: $after) { nodes { id title } pageInfo { endCursor hasNextPage } } }';
    const first = await graphql(t, q);
    expect(first.res.status).toBe(200);
    expect(first.res.headers.get('content-type') ?? '').toContain('application/json');
    expect(first.body.errors).toBeUndefined();
    const page = first.body.data.products;
    expect(page.nodes.map((n: { id: string }) => n.id)).toEqual(['prd_01', 'prd_02']);
    expect(page.pageInfo.hasNextPage).toBe(true);
    const second = await graphql(t, q, { after: page.pageInfo.endCursor });
    expect(second.body.data.products.nodes[0].id).toBe('prd_03');
  });

  it.skipIf(!built(22))('fetches an order with its products in one round trip', async () => {
    const writer = await token('writer');
    const order = await json('/v1/orders', {
      method: 'POST',
      token: writer,
      headers: { 'idempotency-key': uniqueKey() },
      body: { items: [{ productId: 'prd_06', quantity: 2 }] },
    });
    const { body } = await graphql(writer, 'query($id: ID!) { order(id: $id) { id status totalCents items { quantity unitPriceCents product { id title } } } }', {
      id: order.body.id,
    });
    expect(body.errors).toBeUndefined();
    expect(body.data.order).toEqual({
      id: order.body.id,
      status: 'pending',
      totalCents: 7598,
      items: [{ quantity: 2, unitPriceCents: 3799, product: { id: 'prd_06', title: 'The GraphQL Field Guide' } }],
    });
    const product = await graphql(writer, '{ product(id: "prd_nope") { id } }');
    expect(product.body.data.product).toBeNull();
  });

  it('returns FORBIDDEN for order without orders:read, and BAD_USER_INPUT for a bad page size', async () => {
    const productsOnly = await token('reader', 'products:read');
    const forbidden = await graphql(productsOnly, '{ order(id: "ord_000000000000") { id } }');
    expect(forbidden.res.status).toBe(200);
    expect(forbidden.body.data?.order ?? null).toBeNull();
    expect(forbidden.body.errors[0].extensions.code).toBe('FORBIDDEN');

    const bad = await graphql(productsOnly, '{ products(first: 0) { nodes { id } } }');
    expect(bad.body.errors[0].extensions.code).toBe('BAD_USER_INPUT');
  });

  it('needs a token', async () => {
    const res = await call('/graphql', { method: 'POST', body: { query: '{ products { nodes { id } } }' } });
    await problem(res, 401, 'unauthorized');
  });
});

describe('18 · Pagination', () => {
  it('walks every seed product with cursors and a Link header', async () => {
    const t = await token('reader');
    const seen: string[] = [];
    let path: string | null = '/v1/products?limit=10';
    let pages = 0;
    while (path) {
      const { res, body }: { res: Response; body: any } = await json(path, { token: t });
      expect(res.status).toBe(200);
      seen.push(...body.data.map((p: { id: string }) => p.id));
      pages += 1;
      if (body.page.hasMore) {
        const link: string = res.headers.get('link') ?? '';
        expect(link).toMatch(/^<\/v1\/products\?[^>]*cursor=[^>]+>; rel="next"$/);
        path = link.slice(1, link.indexOf('>'));
        expect(decodeURIComponent(path)).toContain(body.page.nextCursor);
      } else {
        expect(body.page.nextCursor).toBeNull();
        expect(res.headers.get('link')).toBeNull();
        path = null;
      }
      expect(pages).toBeLessThan(20);
    }
    expect(seen.slice(0, 25)).toEqual(seedIds);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('keeps the tag filter in the next link', async () => {
    const { res } = await json('/v1/products?limit=2&tag=reliability', { token: await token('reader') });
    expect(res.headers.get('link')).toContain('tag=reliability');
  });

  it('rejects a cursor it did not issue', async () => {
    await problem(await call('/v1/products?cursor=garbage!!', { token: await token('reader') }), 400, 'invalid-cursor');
  });
});

describe('19 · Caching', () => {
  it('serves 304 for a matching If-None-Match on a product', async () => {
    const t = await token('reader');
    const first = await call('/v1/products/prd_02', { token: t });
    expect(first.headers.get('etag')).toBe('"prd_02-v1"');
    expect(first.headers.get('cache-control')).toBe('private, max-age=60');
    const second = await call('/v1/products/prd_02', { token: t, headers: { 'if-none-match': '"prd_02-v1"' } });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
    expect(second.headers.get('etag')).toBe('"prd_02-v1"');
  });

  it('serves 304 for an unchanged list page', async () => {
    const t = await token('reader');
    const first = await call('/v1/products?limit=5', { token: t });
    const etag = first.headers.get('etag')!;
    expect(etag).toMatch(/^W\/".+"$/);
    expect(first.headers.get('cache-control')).toBe('private, max-age=30');
    const second = await call('/v1/products?limit=5', { token: t, headers: { 'if-none-match': etag } });
    expect(second.status).toBe(304);
  });

  it('uses If-Match for optimistic concurrency', async () => {
    const writer = await token('writer');
    const created = await call('/v1/products', { method: 'POST', token: writer, body: { title: 'Cache Me', author: 'A', priceCents: 1 } });
    const { id } = await created.json();
    expect(created.headers.get('etag')).toBe(`"${id}-v1"`);

    const stale = await call(`/v1/products/${id}`, { method: 'PATCH', token: writer, headers: { 'if-match': `"${id}-v9"` }, body: { priceCents: 2 } });
    await problem(stale, 412, 'precondition-failed');

    // If-Match uses strong comparison (RFC 9110): a weak tag never matches, even with the right value.
    const weak = await call(`/v1/products/${id}`, { method: 'PATCH', token: writer, headers: { 'if-match': `W/"${id}-v1"` }, body: { priceCents: 2 } });
    await problem(weak, 412, 'precondition-failed');

    const fresh = await call(`/v1/products/${id}`, { method: 'PATCH', token: writer, headers: { 'if-match': `"${id}-v1"` }, body: { priceCents: 2 } });
    expect(fresh.status).toBe(200);
    expect(fresh.headers.get('etag')).toBe(`"${id}-v2"`);

    const old = await call(`/v1/products/${id}`, { token: writer, headers: { 'if-none-match': `"${id}-v1"` } });
    expect(old.status).toBe(200);
    await call(`/v1/products/${id}`, { method: 'DELETE', token: await token('admin') });
  });
});
