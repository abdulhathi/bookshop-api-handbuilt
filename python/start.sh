#!/usr/bin/env bash
# Starts the API on $PORT: 9001 when you run it yourself; check.sh picks its own port.
exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "${PORT:-9001}"
