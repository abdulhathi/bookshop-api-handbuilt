# Python · FastAPI

My Bookshop API in Python. Dev port **9001**.

## Step 0: create the project (once)

```bash
cd python
python3 -m venv .venv
.venv/bin/pip install fastapi "uvicorn[standard]"
.venv/bin/pip freeze > requirements.txt     # CI installs from this file; update it whenever you add a library
```

Write `app/main.py` with a FastAPI app, then start it:

```bash
./start.sh                                               # what check.sh runs
PORT=9001 .venv/bin/uvicorn app.main:app --port 9001 --reload   # while coding: reloads on save
```

`start.sh` runs `app.main:app`. If you name things differently, change `start.sh`, not `check.sh`.

## Tips

- Load the seed products from `../seed.json` (the server runs from this folder).
- Keep everything in memory, as the spec says: no database.
- Libraries you will want later: PyJWT (concept 10), Strawberry (17), httpx and pytest (23, for the client). Pydantic comes with FastAPI.
- Check a concept: `cd .. && ./check.sh python 1`.
