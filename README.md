# Bookshop API, built by hand

I am building one API three times, in **Python with FastAPI**, **TypeScript with Express** and **C# with ASP.NET Core**,
one concept at a time, while I study 27 API concepts. Every line here is my own. The grader is a black-box contract
suite that does not care which language answers: the same tests must pass against all three.

- **The contract:** [`SPEC.md`](SPEC.md), the Bookshop API (products, orders, OAuth 2.0, webhooks, GraphQL…).
- **The grader:** [`contract-tests/`](contract-tests/), 59 HTTP tests, grouped by concept.
- **The reference:** [abdulhathi/api-concepts-three-stacks](https://github.com/abdulhathi/api-concepts-three-stacks)
  is the finished version with the 27 concept guides. I compare with it only after my tests pass.

## Progress

Updated by `check.sh` each time a concept passes.

<!-- progress:start -->
| # | Concept | Python · FastAPI | TypeScript · Express | C# · ASP.NET Core |
|---|---|:---:|:---:|:---:|
| 1 | Requests and responses |  |  |  |
| 2 | Endpoints |  |  |  |
| 3 | HTTP methods |  |  |  |
| 4 | Headers |  |  |  |
| 5 | Path and query parameters |  |  |  |
| 6 | Request bodies |  |  |  |
| 7 | JSON and serialization |  |  |  |
| 8 | API schemas |  |  |  |
| 9 | Status codes |  |  |  |
| 10 | Authentication |  |  |  |
| 11 | Authorization |  |  |  |
| 12 | Access tokens and JWT |  |  |  |
| 13 | OAuth 2.0 |  |  |  |
| 14 | HTTPS |  |  |  |
| 15 | CORS |  |  |  |
| 16 | REST |  |  |  |
| 17 | GraphQL |  |  |  |
| 18 | Pagination |  |  |  |
| 19 | Caching |  |  |  |
| 20 | Rate limiting |  |  |  |
| 21 | Throttling |  |  |  |
| 22 | Idempotency |  |  |  |
| 23 | Retries |  |  |  |
| 24 | Timeouts |  |  |  |
| 25 | Exponential backoff |  |  |  |
| 26 | Webhooks |  |  |  |
| 27 | Error handling |  |  |  |
| | **Passed** | 0/27 | 0/27 | 0/27 |
<!-- progress:end -->

## How I work, concept by concept

1. Watch the lesson, read the guide and do the practice lab in the API Concepts Lab.
2. Open the lab's **Build** tab for the concept: it lists what to build and the tests that must pass.
3. Write the code in my stack's folder.
4. Run `./check.sh <stack> <concept>`. It starts my server fresh, runs that concept's tests and records a pass.
5. Compare with the reference, then commit: `git add -A && git commit -m "Concept N in <stack>" && git push`.

## Run it

| Folder | Stack | Dev port | Start |
|---|---|---|---|
| [`python/`](python/) | Python, FastAPI | 9001 | `cd python && ./start.sh` |
| [`typescript/`](typescript/) | TypeScript, Express | 9002 | `cd typescript && ./start.sh` |
| [`csharp/`](csharp/) | C#, ASP.NET Core | 9003 | `cd csharp && ./start.sh` |

```bash
cd contract-tests && npm ci && cd ..   # once
./check.sh python 1                    # one concept
./check.sh python all                  # everything passed so far (what CI runs)
```

Until my server has security, the tests adapt: with no token checks yet they send a placeholder token; once concept 10
is built they sign their own JWTs (the key is `JWT_SECRET` in SPEC.md); once concept 13 is built they ask my
`/oauth/token`. Tests that need a later concept (for example orders, concept 22) wait until it is built.

`seed.json` holds the 25 seed products from SPEC.md, so no stack has to type them in.
