#!/usr/bin/env bash
# Checks your own server against the contract tests, one concept at a time.
#   ./check.sh python 1          concept 1 only
#   ./check.sh typescript 11 22  several concepts
#   ./check.sh csharp all        every concept this stack has passed so far (what CI runs)
# It starts your server fresh from <stack>/start.sh on its own port, runs the tests, and stops it.
# When every test of a concept passes, the concept is recorded in progress.json and the README table.
set -euo pipefail

stack="${1:-}"
shift || true
here="$(cd "$(dirname "$0")" && pwd)"
case "$stack" in
  python) port=19001 ;;
  typescript) port=19002 ;;
  csharp) port=19003 ;;
  *) echo "usage: ./check.sh python|typescript|csharp <concept numbers...>|all" >&2; exit 2 ;;
esac
[ $# -gt 0 ] || { echo "Name the concepts to check, for example: ./check.sh $stack 1" >&2; exit 2; }
[ -f "$here/$stack/start.sh" ] || { echo "Write $stack/start.sh first: see $stack/README.md" >&2; exit 2; }
[ -d "$here/contract-tests/node_modules" ] || (cd "$here/contract-tests" && npm ci --silent)

progress=(node "$here/contract-tests/progress.mjs")
if [ "$1" = "all" ]; then
  concepts="$("${progress[@]}" done "$stack")"
  [ -n "$concepts" ] || { echo "No concepts passed yet for $stack."; exit 0; }
else
  concepts="$*"
fi

# What the server has: everything passed before, plus what you are checking now.
built="$("${progress[@]}" built "$stack" $concepts)"
case ",$built," in
  *,13,*) auth=oauth ;;   # your token endpoint issues the tokens
  *,10,*) auth=local ;;   # your server checks tokens; the tests sign their own
  *) auth=off ;;          # no token checks yet
esac
filter="$("${progress[@]}" filter $concepts)"

export WEBHOOK_RETRY_BASE_MS=100
log="$(mktemp)"
(cd "$here/$stack" && PORT="$port" exec bash ./start.sh) >"$log" 2>&1 &
server=$!
stop() { pkill -P "$server" 2>/dev/null || true; kill "$server" 2>/dev/null || true; wait "$server" 2>/dev/null || true; }
trap stop EXIT

for _ in $(seq 1 120); do
  curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1 && break
  kill -0 "$server" 2>/dev/null || { echo "Your server stopped. Its output:" >&2; cat "$log" >&2; exit 1; }
  sleep 0.5
done
curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1 || { echo "No answer from GET /health on port $port. Output:" >&2; cat "$log" >&2; exit 1; }

echo "Checking $stack, concepts: $concepts (tokens: $auth)"
cd "$here/contract-tests"
if API_URL="http://127.0.0.1:$port" CONTRACT_AUTH="$auth" CONTRACT_BUILT="$built" npx vitest run -t "$filter"; then
  "${progress[@]}" record "$stack" $concepts
else
  echo "Not yet: fix the failing tests above, then run this again. Your server's output is in $log" >&2
  exit 1
fi
