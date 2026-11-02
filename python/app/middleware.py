import re
import uuid

SAFE_ID = re.compile(r"[A-Za-z0-9._-]{1,128}")

async def request_context(request, call_next):
	incoming = request.headers.get("x-request-id", "")
	request_id = incoming if SAFE_ID.fullmatch(incoming) else str(uuid.uuid4())
	request.state.request_id = request_id
	response = await call_next(request)
	response.headers["X-Request-Id"] = request_id
	return response