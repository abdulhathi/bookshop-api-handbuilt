import json
import re
import uuid
import time
from datetime import datetime, timezone

SAFE_ID = re.compile(r"[A-Za-z0-9._-]{1,128}")


async def request_context(request, call_next):
  incoming = request.headers.get("x-request-id", "")
  request_id = incoming if SAFE_ID.fullmatch(incoming) else str(uuid.uuid4())
  request.state.request_id = request_id
  start = time.perf_counter()
  response = await call_next(request)
  duration_ms = round((time.perf_counter() - start) * 1000)
  response.headers["X-Request-Id"] = request_id
  print(json.dumps({
      "ts": datetime.now(timezone.utc).isoformat(),
      "level": "error" if response.status_code >= 500 else "info",
      "requestId": request_id,
      "method": request.method,
      "path": request.url.path,
      "status": response.status_code,
      "durationMs": duration_ms,
      "clientId": None,
  }), flush=True)
  return response
