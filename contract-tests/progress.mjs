// Keeps progress.json and the README's progress table, for check.sh.
//   node progress.mjs done <stack>                 concepts passed so far, space separated
//   node progress.mjs built <stack> <concepts...>  passed so far plus these, comma separated (CONTRACT_BUILT)
//   node progress.mjs filter <concepts...>         the vitest -t pattern for these concepts
//   node progress.mjs record <stack> <concepts...> add these to progress.json and redraw the README table
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const PROGRESS = new URL('progress.json', root);
const README = new URL('README.md', root);
const STACKS = { python: 'Python · FastAPI', typescript: 'TypeScript · Express', csharp: 'C# · ASP.NET Core' };
const TITLES = [
  'Requests and responses', 'Endpoints', 'HTTP methods', 'Headers', 'Path and query parameters', 'Request bodies',
  'JSON and serialization', 'API schemas', 'Status codes', 'Authentication', 'Authorization', 'Access tokens and JWT',
  'OAuth 2.0', 'HTTPS', 'CORS', 'REST', 'GraphQL', 'Pagination', 'Caching', 'Rate limiting', 'Throttling',
  'Idempotency', 'Retries', 'Timeouts', 'Exponential backoff', 'Webhooks', 'Error handling',
];

const read = () => JSON.parse(readFileSync(PROGRESS, 'utf8'));
const numbers = (args) => {
  const list = args.map(Number);
  const bad = args.filter((a, i) => !Number.isInteger(list[i]) || list[i] < 1 || list[i] > 27);
  if (bad.length) throw new Error(`Not a concept number (1 to 27): ${bad.join(' ')}`);
  return list;
};
const sorted = (list) => [...new Set(list)].sort((a, b) => a - b);

function table(progress) {
  const head = `| # | Concept | ${Object.values(STACKS).join(' | ')} |\n|---|---|${Object.keys(STACKS).map(() => ':---:').join('|')}|`;
  const rows = TITLES.map((title, i) => {
    const marks = Object.keys(STACKS).map((s) => (progress[s]?.includes(i + 1) ? '✅' : ''));
    return `| ${i + 1} | ${title} | ${marks.join(' | ')} |`;
  });
  const totals = Object.keys(STACKS).map((s) => `${progress[s]?.length ?? 0}/27`);
  return `${head}\n${rows.join('\n')}\n| | **Passed** | ${totals.join(' | ')} |`;
}

const [command, ...args] = process.argv.slice(2);
if (command === 'done') {
  console.log((read()[args[0]] ?? []).join(' '));
} else if (command === 'built') {
  const [stack, ...rest] = args;
  console.log(sorted([...(read()[stack] ?? []), ...numbers(rest)]).join(','));
} else if (command === 'filter') {
  // Concepts 23 and 25 share one group of tests: "23 + 25 · Retries and exponential backoff".
  const parts = sorted(numbers(args)).map((n) => (n === 23 || n === 25 ? '23 \\+ 25' : String(n)));
  console.log(`^(${[...new Set(parts)].join('|')}) ·`);
} else if (command === 'record') {
  const [stack, ...rest] = args;
  const progress = read();
  progress[stack] = sorted([...(progress[stack] ?? []), ...numbers(rest)]);
  writeFileSync(PROGRESS, JSON.stringify(progress, null, 2) + '\n');
  const readme = readFileSync(README, 'utf8').replace(
    /<!-- progress:start -->[\s\S]*<!-- progress:end -->/,
    `<!-- progress:start -->\n${table(progress)}\n<!-- progress:end -->`,
  );
  writeFileSync(README, readme);
  console.log(`Recorded ${STACKS[stack]}: ${progress[stack].length} of 27 concepts. Commit your code with progress.json and README.md.`);
} else if (command === 'table') {
  console.log(table(read()));
} else {
  console.error('usage: node progress.mjs done|built|filter|record|table …');
  process.exit(2);
}
