from fastapi import FastAPI
from app import echo

app = FastAPI(title="Bookshop API")
app.include_router(echo.router)

@app.get("/health")
def health():
	return {"status":"ok"}