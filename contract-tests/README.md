# Contract tests

The Bookshop API's black-box suite, copied from
[api-concepts-three-stacks](https://github.com/abdulhathi/api-concepts-three-stacks/tree/main/contract-tests).
Each `describe` is one concept (`22 · Idempotency`). Run it through `../check.sh`, which picks the tests for the concepts
you name and tells them how far your server has come (`CONTRACT_BUILT`, `CONTRACT_AUTH`; see `src/http.ts`).
Do not change the tests to make them pass: change your server.
