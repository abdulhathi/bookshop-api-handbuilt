#!/usr/bin/env bash
# Starts the API on $PORT: 9003 when you run it yourself; check.sh picks its own port.
exec dotnet run --project src/Bookshop.Api --urls "http://127.0.0.1:${PORT:-9003}"
