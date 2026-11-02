from fastapi import FastAPI
from app import echo
from app.middleware import request_context

app = FastAPI(title="Bookshop API")
app.include_router(echo.router)
app.middleware("http")(request_context)

@app.get("/health")
def health():
	return {"status":"ok"}