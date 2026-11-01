#!/usr/bin/env bash
# Starts the API on $PORT: 9002 when you run it yourself; check.sh picks its own port.
export PORT="${PORT:-9002}"
exec npx tsx src/index.ts
