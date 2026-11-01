import { createHmac } from 'node:crypto';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, json, problem, sleep, TIMESTAMP, token, uniqueKey } from './http';

type Delivery = { headers: IncomingHttpHeaders; raw: string; answeredWith: number };

/** A webhook receiver that fails the first delivery of every event, to make the server retry. */
const received: Delivery[] = [];
const seenEvents = new Set<string>();
const receiver = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    const eventId = String(req.headers['webhook-id']);
    const status = seenEvents.has(eventId) ? 200 : 500;
    seenEvents.add(eventId);
    received.push({ headers: req.headers, raw, answeredWith: status });
    res.writeHead(status).end();
  });
});
let hookUrl = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  hookUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hooks/bookshop`;
});
afterAll(() => new Promise<void>((resolve) => receiver.close(() => resolve())));

async function until<T>(what: string, check: () => Promise<T | undefined>, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await check();
    if (value !== undefined) return value;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe('26 · Webhooks', () => {
  it('only admins manage subscriptions, and events are validated', async () => {
    const body = { url: hookUrl, events: ['order.created'] };
    await problem(await call('/v1/webhooks', { method: 'POST', token: await token('writer'), body }), 403, 'forbidden');
    const bad = await call('/v1/webhooks', { method: 'POST', token: await token('admin'), body: { url: hookUrl, events: ['order.shipped'] } });
    await problem(bad, 400, 'validation-error');
  });

  it('delivers a signed event, retries a failed delivery and logs both attempts', async () => {
    const admin = await token('admin');
    const sub = await json('/v1/webhooks', { method: 'POST', token: admin, body: { url: hookUrl, events: ['order.created', 'order.paid'] } });
    expect(sub.res.status).toBe(201);
    expect(sub.body.id).toMatch(/^whk_[0-9a-f]{12}$/);
    expect(sub.body.secret).toMatch(/^whsec_[0-9a-f]{64}$/);
    expect(sub.body.createdAt).toMatch(TIMESTAMP);

    const listed = await json('/v1/webhooks', { token: admin });
    const mine = listed.body.data.find((w: { id: string }) => w.id === sub.body.id);
    expect(mine).toMatchObject({ url: hookUrl, events: ['order.created', 'order.paid'] });
    expect(mine.secret).toBeUndefined();

    const order = await json('/v1/orders', {
      method: 'POST',
      token: await token('writer'),
      headers: { 'idempotency-key': uniqueKey() },
      body: { items: [{ productId: 'prd_10', quantity: 1 }] },
    });
    expect(order.res.status).toBe(201);

    const forOrder = () => received.filter((d) => JSON.parse(d.raw).data?.order?.id === order.body.id);
    const deliveries = await until('a successful redelivery', async () => (forOrder().some((d) => d.answeredWith === 200) ? forOrder() : undefined));
    expect(deliveries.map((d) => d.answeredWith)).toEqual([500, 200]);

    const { headers, raw } = deliveries[1];
    const event = JSON.parse(raw);
    expect(event).toMatchObject({ type: 'order.created', data: { order: { id: order.body.id, status: 'pending' } } });
    expect(event.id).toMatch(/^evt_[0-9a-f]{12}$/);
    expect(headers['webhook-id']).toBe(event.id);
    expect(deliveries[0].headers['webhook-id']).toBe(event.id);
    expect(headers['content-type']).toContain('application/json');
    const timestamp = String(headers['webhook-timestamp']);
    expect(Math.abs(Date.now() / 1000 - Number(timestamp))).toBeLessThan(60);
    const expected = createHmac('sha256', sub.body.secret).update(`${timestamp}.${raw}`).digest('hex');
    expect(headers['webhook-signature']).toBe(`v1=${expected}`);

    const log = await until('the delivery log to show success', async () => {
      const { body } = await json(`/v1/webhooks/${sub.body.id}/deliveries`, { token: admin });
      const entry = body.data.find((d: { eventId: string }) => d.eventId === event.id);
      return entry?.status === 'succeeded' ? entry : undefined;
    });
    expect(log).toMatchObject({ eventType: 'order.created', status: 'succeeded', attempts: 2, lastStatusCode: 200 });

    const removed = await call(`/v1/webhooks/${sub.body.id}`, { method: 'DELETE', token: admin });
    expect(removed.status).toBe(204);
  });
});

describe('27 · Error handling', () => {
  it('turns an unhandled exception into a 500 problem without leaking details', async () => {
    const res = await call('/v1/demo/crash', { token: await token('reader') });
    const body = await problem(res, 500, 'internal-error', '/v1/demo/crash');
    expect(body.detail).toBe('An unexpected error occurred.');
    expect(JSON.stringify(body)).not.toMatch(/Traceback|at \w+ \(|\.cs:line|File "/i);
  });

  it('answers unknown routes with a 404 problem', async () => {
    await problem(await call('/v1/does-not-exist', { token: await token('reader') }), 404, 'not-found', '/v1/does-not-exist');
  });
});
