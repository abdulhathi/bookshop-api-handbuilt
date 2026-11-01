import { describe, expect, it } from 'vitest';
import { call, json, problem, token, uniqueKey } from './http';

describe('20 · Rate limiting', () => {
  it('counts down RateLimit-Remaining and answers 429 with Retry-After when the free plan runs out', async () => {
    // The free plan allows 5 requests a minute. Earlier tests may have spent some, so count down from wherever it is.
    const t = await token('free');
    let previous = Infinity;
    for (let i = 0; i < 6; i++) {
      const res = await call('/v1/products?limit=1', { token: t });
      expect(res.headers.get('ratelimit-limit')).toBe('5');
      const remaining = Number(res.headers.get('ratelimit-remaining'));
      if (res.status === 429) {
        await problem(res, 429, 'rate-limited', '/v1/products');
        expect(remaining).toBe(0);
        expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
        expect(Number(res.headers.get('ratelimit-reset'))).toBeGreaterThanOrEqual(1);
        return;
      }
      expect(res.status).toBe(200);
      expect(remaining).toBeLessThan(previous);
      expect(res.headers.get('ratelimit-reset')).toBe(remaining > 0 ? '0' : res.headers.get('ratelimit-reset'));
      previous = remaining;
    }
    throw new Error('six requests on the free plan never got a 429');
  });

  it('gives the standard plan its own, larger bucket', async () => {
    const res = await call('/v1/products?limit=1', { token: await token('reader') });
    expect(res.status).toBe(200);
    expect(res.headers.get('ratelimit-limit')).toBe('1000');
  });

  it('does not rate limit the health check', async () => {
    const res = await call('/health');
    expect(res.headers.get('ratelimit-limit')).toBeNull();
  });
});

describe('21 · Throttling', () => {
  it('runs 2 reports, queues 2 and turns the rest away with 503', async () => {
    const t = await token('admin');
    const started = Date.now();
    const responses = await Promise.all(Array.from({ length: 6 }, () => call('/v1/reports/sales?delayMs=600', { token: t })));
    const ok = responses.filter((r) => r.status === 200);
    const throttled = responses.filter((r) => r.status === 503);
    expect(ok).toHaveLength(4);
    expect(throttled).toHaveLength(2);
    for (const res of throttled) {
      expect(res.headers.get('retry-after')).toBe('1');
      await problem(res, 503, 'throttled', '/v1/reports/sales');
    }
    // The queued pair waited for the first pair, so the whole batch took about two rounds of work.
    expect(Date.now() - started).toBeGreaterThanOrEqual(1100);
    const report = await ok[0].json();
    expect(report).toMatchObject({ orderCount: expect.any(Number), paidCount: expect.any(Number), revenueCents: expect.any(Number) });
  });
});

describe('22 · Idempotency', () => {
  const order = { items: [{ productId: 'prd_01', quantity: 2 }, { productId: 'prd_03', quantity: 1 }] };

  it('requires an Idempotency-Key on order creation', async () => {
    await problem(await call('/v1/orders', { method: 'POST', token: await token('writer'), body: order }), 400, 'idempotency-key-required', '/v1/orders');
  });

  it('replays the first response for a retry with the same key and body', async () => {
    const writer = await token('writer');
    const key = uniqueKey();
    const body = JSON.stringify(order);
    const first = await call('/v1/orders', { method: 'POST', token: writer, headers: { 'idempotency-key': key }, body });
    expect(first.status).toBe(201);
    expect(first.headers.get('idempotent-replayed')).toBeNull();
    const created = await first.json();
    expect(created).toMatchObject({
      clientId: 'writer',
      status: 'pending',
      currency: 'USD',
      totalCents: 2 * 3499 + 2599,
      items: [
        { productId: 'prd_01', title: 'HTTP from the Ground Up', quantity: 2, unitPriceCents: 3499, lineTotalCents: 6998 },
        { productId: 'prd_03', title: 'JSON in Practice', quantity: 1, unitPriceCents: 2599, lineTotalCents: 2599 },
      ],
    });
    expect(created.id).toMatch(/^ord_[0-9a-f]{12}$/);

    const retry = await call('/v1/orders', { method: 'POST', token: writer, headers: { 'idempotency-key': key }, body });
    expect(retry.status).toBe(201);
    expect(retry.headers.get('idempotent-replayed')).toBe('true');
    expect(retry.headers.get('location')).toBe(first.headers.get('location'));
    expect(await retry.json()).toEqual(created);

    const reused = await call('/v1/orders', {
      method: 'POST',
      token: writer,
      headers: { 'idempotency-key': key },
      body: { items: [{ productId: 'prd_02', quantity: 1 }] },
    });
    await problem(reused, 422, 'idempotency-key-reused');
  });

  it('scopes keys to the client', async () => {
    const key = uniqueKey();
    const a = await json('/v1/orders', { method: 'POST', token: await token('writer'), headers: { 'idempotency-key': key }, body: order });
    const b = await json('/v1/orders', { method: 'POST', token: await token('partner'), headers: { 'idempotency-key': key }, body: order });
    expect(b.res.status).toBe(201);
    expect(b.res.headers.get('idempotent-replayed')).toBeNull();
    expect(b.body.id).not.toBe(a.body.id);
  });

  it('rejects unknown products with 422 and keeps paying idempotent', async () => {
    const writer = await token('writer');
    const missing = await call('/v1/orders', {
      method: 'POST',
      token: writer,
      headers: { 'idempotency-key': uniqueKey() },
      body: { items: [{ productId: 'prd_nope', quantity: 1 }] },
    });
    await problem(missing, 422, 'unknown-product');

    const { body } = await json('/v1/orders', { method: 'POST', token: writer, headers: { 'idempotency-key': uniqueKey() }, body: order });
    const paid = await json(`/v1/orders/${body.id}/pay`, { method: 'POST', token: writer });
    expect(paid.res.status).toBe(200);
    expect(paid.body.status).toBe('paid');
    const again = await json(`/v1/orders/${body.id}/pay`, { method: 'POST', token: writer });
    expect(again.res.status).toBe(200);
    expect(again.body).toEqual(paid.body);
  });

  it('validates order bodies', async () => {
    const writer = await token('writer');
    for (const body of [{ items: [] }, { items: [{ productId: 'prd_01', quantity: 0 }] }, { items: [{ productId: 'prd_01', quantity: 101 }] }]) {
      await problem(await call('/v1/orders', { method: 'POST', token: writer, headers: { 'idempotency-key': uniqueKey() }, body }), 400, 'validation-error');
    }
  });
});

describe('23 + 25 · Retries and exponential backoff (server side of the demo)', () => {
  it('fails the first failTimes calls with 503 and then succeeds', async () => {
    const t = await token('reader');
    const key = uniqueKey();
    for (let i = 0; i < 2; i++) {
      const res = await call(`/v1/demo/flaky?key=${key}&failTimes=2`, { token: t });
      await problem(res, 503, 'service-unavailable', '/v1/demo/flaky');
      expect(res.headers.get('retry-after')).toBeNull();
    }
    const ok = await json(`/v1/demo/flaky?key=${key}&failTimes=2`, { token: t });
    expect(ok.res.status).toBe(200);
    expect(ok.body).toEqual({ key, attempts: 3 });
  });
});

describe('24 · Timeouts', () => {
  it('cancels a report that runs past the server timeout and answers 504', async () => {
    const started = Date.now();
    const res = await call('/v1/reports/sales?delayMs=3000', { token: await token('admin') });
    const took = Date.now() - started;
    await problem(res, 504, 'timeout', '/v1/reports/sales');
    expect(took).toBeGreaterThanOrEqual(1800);
    expect(took).toBeLessThan(2900);
  });
});
