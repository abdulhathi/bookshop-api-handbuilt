# API contract: the Bookshop API

One HTTP contract, implemented three times. Every implementation must behave exactly as written here, because the same
black-box contract suite (`contract-tests/`) runs against all three servers.

| Folder | Stack | Cloud | Local port |
|---|---|---|---|
| `python-fastapi-aws/` | Python 3.12+, FastAPI | AWS Lambda + API Gateway (SAM) | 8001 |
| `node-typescript-gcp/` | Node.js 22+, TypeScript, Express 5 | Google Cloud Run | 8002 |
| `dotnet-azure/` | C#, .NET 9 Minimal APIs | Azure App Service (Bicep) | 8003 |

Storage is in memory (seeded on start), so every server runs with no database, no Docker and no cloud account.

## The 27 concepts and where the contract exercises them

| # | Concept | Exercised by |
|---|---|---|
| 1 | Requests and responses | `GET/POST /v1/echo`, structured request log line |
| 2 | Endpoints | resource routes under `/v1` |
| 3 | HTTP methods | GET, POST, PUT, PATCH, DELETE on products |
| 4 | Headers | `X-Request-Id`, `Content-Type` (415), `Location`, security headers |
| 5 | Path and query parameters | `/v1/products/{id}`, `?limit&cursor&tag` |
| 6 | Request bodies | JSON bodies validated on POST/PUT/PATCH |
| 7 | JSON and serialization | camelCase, integer cents, RFC 3339 UTC timestamps |
| 8 | API schemas | OpenAPI at `/openapi.json`, docs UI at `/docs` |
| 9 | Status codes | 200 201 204 304 400 401 403 404 409 412 415 422 429 500 503 504 |
| 10 | Authentication | Bearer token required; 401 + `WWW-Authenticate` |
| 11 | Authorization | scopes (403) and ownership (404 for another client's order) |
| 12 | Access tokens and JWT | HS256 JWT with `iss aud sub scope iat exp jti` |
| 13 | OAuth 2.0 | client credentials grant at `POST /oauth/token` |
| 14 | HTTPS | HSTS when the request arrived over HTTPS (`X-Forwarded-Proto`) |
| 15 | CORS | origin allowlist, preflight, exposed headers |
| 16 | REST | resources, uniform interface, `Location`, `Link` |
| 17 | GraphQL | `POST /graphql` with nested order → product query |
| 18 | Pagination | opaque cursor, `page` object, `Link: rel="next"` |
| 19 | Caching | `ETag`, `If-None-Match` → 304, `Cache-Control`, `If-Match` → 412 |
| 20 | Rate limiting | token bucket per client plan; 429 + `Retry-After` + `RateLimit-*` |
| 21 | Throttling | concurrency limit + queue on the report endpoint; 503 when full |
| 22 | Idempotency | `Idempotency-Key` on `POST /v1/orders`, replay header |
| 23 | Retries | the typed client retries safe failures |
| 24 | Timeouts | server request timeout (504) and client per-attempt timeout |
| 25 | Exponential backoff | client and webhook retries back off with jitter |
| 26 | Webhooks | subscriptions, HMAC-signed deliveries, retries, delivery log |
| 27 | Error handling | RFC 9457 `application/problem+json` everywhere |

## Configuration (environment variables, same names in every stack)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 8001 / 8002 / 8003 | listen port |
| `JWT_SECRET` | `dev-only-secret-change-me-0123456789abcdef` | HS256 key (at least 32 bytes) |
| `JWT_ISSUER` | `api-concepts` | `iss` claim |
| `JWT_AUDIENCE` | `api-concepts-clients` | `aud` claim |
| `TOKEN_TTL_SECONDS` | `900` | access token lifetime |
| `CORS_ORIGINS` | `http://localhost:5173` | comma-separated allowlist |
| `REQUEST_TIMEOUT_MS` | `2000` | server timeout for the report endpoint |
| `WEBHOOK_RETRY_BASE_MS` | `500` | first webhook retry delay |
| `WEBHOOK_MAX_ATTEMPTS` | `5` | attempts per delivery, including the first |

## Demo OAuth clients (dev only; documented as such)

| client_id | client_secret | scopes | plan |
|---|---|---|---|
| `reader` | `reader-secret` | `products:read orders:read` | standard |
| `writer` | `writer-secret` | `products:read products:write orders:read orders:write` | standard |
| `partner` | `partner-secret` | `products:read products:write orders:read orders:write` | standard |
| `admin` | `admin-secret` | `products:read products:write orders:read orders:write admin` | standard |
| `free` | `free-secret` | `products:read` | free |

Plans: **free** = 5 requests per minute, **standard** = 1000 requests per minute.

## Cross-cutting rules

### Request ID (concept 4)
Every response, including errors, 304s and 404s for unknown routes, carries `X-Request-Id`. If the request had an
`X-Request-Id` matching `^[A-Za-z0-9._-]{1,128}$`, echo it; otherwise generate a UUID v4.

### Security headers (concept 14)
Every response: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
When the request arrived over HTTPS (the connection is TLS, or `X-Forwarded-Proto: https`):
`Strict-Transport-Security: max-age=31536000; includeSubDomains`. Never send HSTS over plain HTTP.
TLS itself terminates at the cloud edge (API Gateway, Cloud Run, App Service); the README of each stack says so.

### Cache-Control default (concept 19)
Any response under `/v1`, `/graphql` or `/oauth` that did not set `Cache-Control` gets `Cache-Control: no-store`.

### CORS (concept 15)
Origins in `CORS_ORIGINS` only. No credentials (bearer tokens, not cookies), so never send
`Access-Control-Allow-Credentials`.
- Preflight (`OPTIONS` with `Origin` + `Access-Control-Request-Method`) from an allowed origin: status 204 or 200,
  `Access-Control-Allow-Origin: <origin>`, `Access-Control-Allow-Methods` containing GET, POST, PUT, PATCH, DELETE,
  `Access-Control-Allow-Headers` containing Authorization, Content-Type, Idempotency-Key, If-Match, If-None-Match,
  X-Request-Id; `Access-Control-Max-Age: 600`. Preflights skip authentication and rate limiting.
- Actual request from an allowed origin: `Access-Control-Allow-Origin: <origin>`, `Vary` includes `Origin`,
  `Access-Control-Expose-Headers` containing ETag, Link, Location, Retry-After, RateLimit-Limit, RateLimit-Remaining,
  RateLimit-Reset, X-Request-Id, Idempotent-Replayed.
- Disallowed origin: no `Access-Control-Allow-Origin` header (status not specified).

### Content type (concept 4)
POST, PUT and PATCH with a body under `/v1` must send `Content-Type: application/json` (charset allowed;
`application/merge-patch+json` is also accepted on PATCH). Anything else → 415 `unsupported-media-type`.
Body that is not valid JSON → 400 `malformed-json`. `/oauth/token` takes `application/x-www-form-urlencoded`.

### JSON shape (concept 7)
- Property names camelCase. Unknown request properties are ignored.
- Money is an integer number of cents (`priceCents`, `totalCents`). Currency is always `"USD"` (output only).
- Timestamps are RFC 3339 UTC with a `Z` suffix and millisecond precision: `2026-01-01T00:00:00.000Z`.
- Nullable fields are present with `null`, never omitted.

### Errors (concept 27)
Every error (except the OAuth token endpoint, which follows RFC 6749) is `application/problem+json` (RFC 9457):

```json
{
  "type": "/problems/validation-error",
  "title": "Your request is not valid",
  "status": 400,
  "detail": "limit must be between 1 and 50",
  "instance": "/v1/products",
  "requestId": "3f0c…",
  "errors": [{ "field": "limit", "message": "must be between 1 and 50" }]
}
```

`type` is the relative URI `/problems/<slug>`. `instance` is the request path (no query string). `requestId` equals the
`X-Request-Id` response header. `errors` is present only for `validation-error`. 500s never leak stack traces or
exception messages: detail is exactly `An unexpected error occurred.` and the exception is logged with the request ID.

| Slug | Status | Title (the same in every stack) | When |
|---|---|---|---|
| `validation-error` | 400 | Your request is not valid | query, path or body fails its schema |
| `malformed-json` | 400 | The request body is not valid JSON | body is not JSON |
| `invalid-cursor` | 400 | The pagination cursor is not valid | cursor cannot be decoded |
| `idempotency-key-required` | 400 | An Idempotency-Key header is required | `POST /v1/orders` without `Idempotency-Key` (1–255 chars) |
| `unauthorized` | 401 | Authentication is required | missing, malformed, expired or badly signed token |
| `forbidden` | 403 | You are not allowed to do this | token lacks the scope |
| `not-found` | 404 | Resource not found | unknown id, another client's order, or unknown route |
| `method-not-allowed` | 405 | Method not allowed | known path, wrong method (optional: a stack may answer 404 `not-found` instead) |
| `invalid-state` | 409 | The resource is in a state that does not allow this | state transition not allowed |
| `idempotency-key-in-progress` | 409 | A request with this Idempotency-Key is in progress | same key still being processed |
| `precondition-failed` | 412 | The resource changed since you last saw it | `If-Match` does not match the current ETag |
| `unsupported-media-type` | 415 | Unsupported media type | wrong `Content-Type` |
| `unknown-product` | 422 | The order references an unknown product | order references a product that does not exist |
| `idempotency-key-reused` | 422 | This Idempotency-Key was used with a different request | same key, different request body |
| `rate-limited` | 429 | Too many requests | bucket empty |
| `internal-error` | 500 | Internal server error | unhandled exception |
| `throttled` | 503 | The server is busy | report queue full |
| `service-unavailable` | 503 | The service is temporarily unavailable | the flaky demo endpoint failing on purpose |
| `timeout` | 504 | The request took too long | report took longer than `REQUEST_TIMEOUT_MS` |

401 also sends `WWW-Authenticate: Bearer realm="api-concepts"` (with `, error="invalid_token"` when a token was sent
but rejected). 403 sends `WWW-Authenticate: Bearer realm="api-concepts", error="insufficient_scope", scope="<needed>"`.

### Authentication and JWT (concepts 10, 12)
`Authorization: Bearer <jwt>` on every `/v1` and `/graphql` route. JWT: HS256, header `typ: JWT`; claims `iss`, `aud`,
`sub` (client_id), `scope` (space-separated), `iat`, `exp` (`iat + TOKEN_TTL_SECONDS`), `jti` (UUID). Validation
checks signature, algorithm (HS256 only), `exp` (no leeway), `iss`, `aud`.

### Rate limiting (concept 20)
Token bucket per client (`sub`); capacity = plan limit, refilled continuously at limit/60 tokens per second. Applies to
every authenticated `/v1` and `/graphql` request after authentication succeeds (a 401 is not counted). Every such
response carries:
- `RateLimit-Limit: <plan limit>`
- `RateLimit-Remaining: <whole tokens left after this request>`
- `RateLimit-Reset: <seconds, rounded up, until one more token is available; 0 if Remaining > 0>`

Empty bucket → 429 `rate-limited` with `Retry-After: <same seconds, at least 1>` and the three headers.

## Endpoints

Scopes in brackets. "any" = any valid token.

| Method and path | Scope | Success |
|---|---|---|
| `GET /` | none | 200 `{ "name": "Bookshop API", "docs": "/docs", "openapi": "/openapi.json" }` |
| `GET /health` | none | 200 `{ "status": "ok" }`, never rate limited |
| `GET /openapi.json` | none | OpenAPI 3.x document |
| `GET /docs` | none | interactive docs UI (Swagger UI or Scalar) |
| `POST /oauth/token` | none | 200 token response |
| `GET /v1/me` | any | 200 `{ clientId, scopes: string[], plan, tokenExpiresAt }` |
| `GET\|POST /v1/echo` | any | 200 echo of the request |
| `GET /v1/products` | products:read | 200 page of products |
| `GET /v1/products/{id}` | products:read | 200 product, or 304 |
| `POST /v1/products` | products:write | 201 product + `Location` |
| `PUT /v1/products/{id}` | products:write | 200 product (full replace) |
| `PATCH /v1/products/{id}` | products:write | 200 product (partial) |
| `DELETE /v1/products/{id}` | admin | 204 |
| `POST /v1/orders` | orders:write | 201 order + `Location` |
| `GET /v1/orders` | orders:read | 200 page of the caller's orders (admin: all) |
| `GET /v1/orders/{id}` | orders:read | 200 order (owner or admin; else 404) |
| `POST /v1/orders/{id}/pay` | orders:write | 200 order with status `paid` |
| `GET /v1/reports/sales` | orders:read | 200 report (throttled, time-limited) |
| `GET /v1/demo/flaky` | any | 503 the first `failTimes` calls per key, then 200 |
| `GET /v1/demo/crash` | any | always 500 `internal-error` |
| `POST /v1/webhooks` | admin | 201 subscription including its `secret` |
| `GET /v1/webhooks` | admin | 200 `{ data: [...] }` (no secrets) |
| `DELETE /v1/webhooks/{id}` | admin | 204 |
| `GET /v1/webhooks/{id}/deliveries` | admin | 200 `{ data: [...] }` |
| `POST /graphql` | products:read (+ orders:read for `order`) | 200 GraphQL response |

### OAuth 2.0 token endpoint (concept 13)
`POST /oauth/token`, form-encoded: `grant_type=client_credentials`, optional `scope` (space-separated). Client
authentication by HTTP Basic (`client_secret_basic`) or by `client_id` + `client_secret` form fields
(`client_secret_post`). Response headers `Cache-Control: no-store`.

Success: `{ "access_token": "<jwt>", "token_type": "Bearer", "expires_in": 900, "scope": "<granted>" }`. Omitted
`scope` grants all of the client's scopes; a requested scope the client does not have → `invalid_scope`.

Errors are RFC 6749 JSON `{ "error": "...", "error_description": "..." }`: `invalid_client` → 401 (with
`WWW-Authenticate: Basic realm="api-concepts"`), `unsupported_grant_type`, `invalid_scope`, `invalid_request` → 400.

### Echo (concepts 1, 4, 5)
Returns `{ method, path, query, headers, body }`: `query` maps each name to its first value; `headers` has lower-case
names mapped to their value, with `authorization` replaced by `"Bearer ***"`; `body` is the parsed JSON or `null`.

### Products (concepts 2, 3, 5, 6, 16, 18, 19)
Product: `{ id, title, author, priceCents, currency, tags, version, createdAt, updatedAt }`.
- `title` 1–200 chars, `author` 1–100 chars (both trimmed, non-empty), `priceCents` integer 0–10000000,
  `tags` array of at most 10 unique strings matching `^[a-z0-9-]{1,30}$` (default `[]`).
- New ids are `prd_` + 12 random lowercase hex characters. `version` starts at 1 and increases by 1 on every change.
- Seed data: see the table at the end. Products are ordered by `createdAt`, then `id`. New products sort last.

**List** `GET /v1/products?limit=10&cursor=<opaque>&tag=<tag>`: `limit` 1–50 (default 10). Response:
`{ "data": [...], "page": { "limit": 10, "nextCursor": "<opaque>" | null, "hasMore": true } }`. When `hasMore`, send
`Link: </v1/products?limit=10&cursor=<url-encoded cursor>[&tag=<tag>]>; rel="next"`. Cursors are opaque strings that
only the server understands; a cursor that does not decode → 400 `invalid-cursor`.

**Get one**: `ETag: "<id>-v<version>"` (strong), `Cache-Control: private, max-age=60`. `If-None-Match` matching the
ETag (or `*`) → 304 with no body, same `ETag` and `Cache-Control`.

**List caching**: `ETag: W/"<hash of the response body>"`, `Cache-Control: private, max-age=30`, `If-None-Match` → 304.

**Create** `POST` `{ title, author, priceCents, tags? }` → 201, `Location: /v1/products/<id>`, product body, `ETag`.
**Replace** `PUT` needs all of `title, author, priceCents, tags`. **Patch** `PATCH` takes any subset.
**Delete** → 204. PUT, PATCH and DELETE honor `If-Match`: present and not equal to the current ETag → 412
`precondition-failed`. Unknown id → 404.

### Orders (concepts 11, 22, 26)
Order: `{ id, clientId, status, items, totalCents, currency, createdAt, updatedAt }`; item:
`{ productId, title, quantity, unitPriceCents, lineTotalCents }`. Ids are `ord_` + 12 random lowercase hex chars.
Status is `pending` or `paid`.

**Create** `POST /v1/orders` with `Idempotency-Key` and `{ "items": [{ "productId": "prd_01", "quantity": 2 }] }`:
1–50 items, quantity 1–100 → 201, `Location: /v1/orders/<id>`. A missing product → 422 `unknown-product`.
Idempotency, keyed by (client, key), kept 24 hours:
- First request: process; store status, body and `Location` of a 201 only.
- Same key and byte-identical body (compare SHA-256 of the raw body): return the stored 201 with the same body and
  `Location`, plus `Idempotent-Replayed: true`. No new order, no new webhook event.
- Same key, different body → 422 `idempotency-key-reused`.
- Same key while the first is still in flight → 409 `idempotency-key-in-progress`.
- The first (non-replayed) response sends no `Idempotent-Replayed` header.

**Pay** `POST /v1/orders/{id}/pay`: pending → paid (emits `order.paid`); already paid → 200 unchanged, no event.
Another client's order (not admin) → 404 everywhere.

### Report: throttling and timeouts (concepts 21, 24)
`GET /v1/reports/sales?delayMs=300`: `delayMs` 0–10000 (default 300) simulates slow work, then returns
`{ orderCount, paidCount, revenueCents, generatedAt }` over all orders (revenue = sum of paid totals).
- **Throttling**: at most 2 reports run at once and at most 2 more wait in a FIFO queue. A request that finds 2 running
  and 2 waiting → 503 `throttled` with `Retry-After: 1`, immediately.
- **Timeout**: if the work takes longer than `REQUEST_TIMEOUT_MS`, cancel it and return 504 `timeout` at that moment. The clock starts when the report starts running: time spent waiting in the queue does not count.

### Flaky and crash demos (concepts 23, 25, 27)
`GET /v1/demo/flaky?key=<string 1–64>&failTimes=<0–10, default 2>`: counts calls per key; calls 1..failTimes → 503
`service-unavailable` (no `Retry-After`); later calls → 200 `{ "key": "...", "attempts": <calls so far> }`.
`GET /v1/demo/crash` raises an unhandled exception → 500 `internal-error`.

### Webhooks (concept 26)
**Subscribe** `POST /v1/webhooks` `{ "url": "http(s)://…", "events": ["order.created", "order.paid"] }` (events
non-empty, from that list) → 201 `{ id, url, events, secret, createdAt }`. Ids `whk_` + 12 hex; secret `whsec_` + 64 hex.

**Event** body: `{ "id": "evt_<12 hex>", "type": "order.created", "createdAt": "…", "data": { "order": { … } } }`.

**Delivery** to every subscription listening for the type, in the background (never blocks the API response):
`POST <url>` with headers `Content-Type: application/json`, `Webhook-Id: <event id>`,
`Webhook-Timestamp: <unix seconds>`, `Webhook-Signature: v1=<lowercase hex HMAC-SHA256>`, where the HMAC key is the
UTF-8 bytes of the whole secret (including `whsec_`) and the message is `<timestamp>.<raw body>`. A 2xx within 5 s is
success. Otherwise retry: delay before retry n (n = 1, 2, …) is `random(0.5, 1.0) × min(60000, WEBHOOK_RETRY_BASE_MS
× 2^(n−1))` ms, up to `WEBHOOK_MAX_ATTEMPTS` attempts in total.

**Delivery log** `GET /v1/webhooks/{id}/deliveries` → `{ data: [{ id, eventId, eventType, status, attempts,
lastStatusCode, lastError, createdAt, updatedAt }] }` in creation order; `status` is `pending`, `succeeded` or `failed`;
`lastStatusCode` and `lastError` are `null` until set. Each stack ships a `verify signature` helper that receivers use:
it recomputes the HMAC with a constant-time comparison and rejects timestamps more than 300 s from now.

### GraphQL (concept 17)
`POST /graphql` with `{ query, variables? }`, `Content-Type: application/json`. No token → HTTP 401 problem; token
without `products:read` → HTTP 403 problem. Schema:

```graphql
type Query {
  products(first: Int = 10, after: String, tag: String): ProductConnection!
  product(id: ID!): Product
  order(id: ID!): Order
}
type ProductConnection { nodes: [Product!]!  pageInfo: PageInfo! }
type PageInfo { endCursor: String  hasNextPage: Boolean! }
type Product { id: ID!  title: String!  author: String!  priceCents: Int!  currency: String!  tags: [String!]! }
type Order { id: ID!  status: String!  totalCents: Int!  items: [OrderItem!]! }
type OrderItem { quantity: Int!  unitPriceCents: Int!  product: Product }
```

IDs are the plain REST ids (`prd_01`), never Relay-encoded. `after` takes `endCursor` from a previous page. `first`
outside 1–50 → a GraphQL error with `extensions.code = "BAD_USER_INPUT"`. `order` needs `orders:read`, else a
GraphQL error with `extensions.code = "FORBIDDEN"` and `data.order = null`; another client's order is `null`.
GraphQL responses are HTTP 200 with `Content-Type: application/json` when the request sends `Accept: application/json`.

### Logging (concept 1)
One JSON line per request to stdout: `{ "ts", "level", "requestId", "method", "path", "status", "durationMs",
"clientId" }` (`clientId` null when unauthenticated). Never log tokens, secrets or bodies.

## The typed client (concepts 23, 24, 25)

Each stack ships a small client library used by its tests and an example script:
- Fetches a token with client credentials and caches it until 30 s before expiry.
- Per-attempt timeout (default 5 s).
- Retries at most 3 times (4 attempts) on network errors, timeouts, 408, 429, 502, 503, 504. Never on other 4xx/5xx.
- Retries only idempotent methods (GET, HEAD, PUT, DELETE, OPTIONS) or any request that carries an `Idempotency-Key` (in practice a POST, sometimes a PATCH);
  `createOrder` always generates one key (UUID) and reuses it on every attempt.
- Delay before retry n: `Retry-After` seconds when the response has it, otherwise
  `random(0.5, 1.0) × min(5000, 200 × 2^(n−1))` ms. Both base and cap are options so tests run fast.
- Throws a typed error carrying the problem details when it gives up.
- Example script: retries `GET /v1/demo/flaky?failTimes=2` and prints each attempt and its delay.

## Seed products

`createdAt` = `updatedAt` = `2026-01-01T00:00:00.000Z` plus (n − 1) minutes; `version` 1; currency `USD`.

| id | title | author | priceCents | tags |
|---|---|---|---|---|
| prd_01 | HTTP from the Ground Up | Maya Chen | 3499 | http, basics |
| prd_02 | Designing Resource APIs | Luis Ortega | 4299 | rest, design |
| prd_03 | JSON in Practice | Priya Raman | 2599 | json, basics |
| prd_04 | Tokens and Trust | Samuel Okafor | 3999 | security, auth |
| prd_05 | OAuth Without Tears | Hana Suzuki | 4499 | security, oauth |
| prd_06 | The GraphQL Field Guide | Noah Fischer | 3799 | graphql |
| prd_07 | Caching at the Edge | Amira Haddad | 3299 | caching, performance |
| prd_08 | Rate Limits in Real Life | Diego Alvarez | 2899 | reliability |
| prd_09 | Retry, Back Off, Recover | Grace Kim | 3199 | reliability |
| prd_10 | Webhooks That Work | Omar Siddiqui | 2999 | webhooks, events |
| prd_11 | Errors Worth Reading | Elena Petrova | 2499 | errors, design |
| prd_12 | Pagination Patterns | Kwame Mensah | 2199 | design, performance |
| prd_13 | Idempotent by Design | Sofia Rossi | 3599 | reliability, design |
| prd_14 | Schemas First | Ravi Patel | 3399 | openapi, design |
| prd_15 | CORS Explained | Lena Novak | 1999 | security, browser |
| prd_16 | TLS for Developers | Ahmed Karim | 4199 | security, https |
| prd_17 | Serverless APIs on AWS | Julia Santos | 4799 | aws, cloud |
| prd_18 | Cloud Run in Production | Ben Carter | 4599 | gcp, cloud |
| prd_19 | Shipping .NET on Azure | Fatima Zahra | 4699 | azure, cloud |
| prd_20 | FastAPI Recipes | Wei Zhang | 3899 | python |
| prd_21 | TypeScript Services | Chloe Martin | 3999 | typescript, node |
| prd_22 | Minimal APIs in C# | Arjun Nair | 3799 | csharp, dotnet |
| prd_23 | Timeouts and Deadlines | Isabel Cruz | 2799 | reliability |
| prd_24 | Observability for APIs | Tomás Silva | 4399 | operations |
| prd_25 | The API Interview Handbook | Nadia Rahman | 2999 | career |
