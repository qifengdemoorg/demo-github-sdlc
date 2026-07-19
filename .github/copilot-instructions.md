# TaskFlow — Copilot Instructions

TaskFlow is a minimal FastAPI task management API used to demonstrate the GitHub Agentic SDLC.

## Project layout

- `app/models.py` — Pydantic models (`Task`, `TaskCreate`, `TaskUpdate`)
- `app/main.py` — FastAPI routes with an in-memory store (`_tasks` dict)
- `tests/test_tasks.py` — pytest suite using `fastapi.testclient`

## Conventions

- Python 3.11+ typing style: `str | None`, built-in generics (`list[Task]`, `dict[int, Task]`).
- Keep the in-memory store; do not introduce a database.
- Every new field on `Task` must be added to `TaskCreate`/`TaskUpdate` as appropriate, with validation.
- Every new endpoint or field requires tests in `tests/`. Run `pytest` and `ruff check .` before finishing.
- API errors use `HTTPException` with meaningful `detail` messages; 404 for missing tasks, 422 for validation.
- Line length limit is 100 (ruff enforced).

## Code review focus

- Validation gaps (e.g., unbounded strings, missing enum constraints).
- Missing test coverage for new behavior, including error paths.
- Breaking changes to existing endpoint contracts.
