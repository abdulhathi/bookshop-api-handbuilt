# TypeScript · Express

My Bookshop API in TypeScript with Express 5. Dev port **9002**.

## Step 0: create the project (once)

```bash
cd typescript
npm init -y
npm pkg set type=module
npm install express@5
npm install -D typescript tsx @types/express @types/node
npx tsc --init
```

Write `src/index.ts`: create the Express app and listen on `Number(process.env.PORT ?? 9002)`. Then start it:

```bash
./start.sh                          # what check.sh runs
PORT=9002 npx tsx watch src/index.ts   # while coding: restarts on save
```

`start.sh` runs `src/index.ts`. If you name things differently, change `start.sh`, not `check.sh`.

## Tips

- Load the seed products from `../seed.json` (the server runs from this folder).
- Keep everything in memory, as the spec says: no database.
- Libraries you will want later: zod (concept 6), jose (10), graphql and graphql-http (17), vitest (23, for the client).
- Type-check with `npx tsc --noEmit` before you commit.
- Check a concept: `cd .. && ./check.sh typescript 1`.
