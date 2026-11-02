import json
from fastapi import Request, APIRouter

router = APIRouter()


@router.api_route("/v1/echo", methods=["GET", "POST"])
async def echo(request: Request):
  query = {name: request.query_params.getlist(
      name)[0] for name in request.query_params}
  headers = dict(request.headers.items())
  if "authorization" in headers:
    headers["authorization"] = "Bearer ***"
  raw = await request.body()
  return {
      "method": request.method,
      "path": request.url.path,
      "query": query,
      "headers": headers,
      "body": json.loads(raw) if raw else None
  }
