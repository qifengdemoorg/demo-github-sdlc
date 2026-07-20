"""TaskFlow API - minimal task management service."""

from datetime import date

from fastapi import FastAPI, HTTPException

from app.models import Task, TaskCreate, TaskUpdate

app = FastAPI(title="TaskFlow", version="0.1.0")

# In-memory store keeps the demo dependency-free.
_tasks: dict[int, Task] = {}
_next_id = 1


def reset_store() -> None:
    """Reset the in-memory store (used by tests)."""
    global _next_id
    _tasks.clear()
    _next_id = 1


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/tasks")
def list_tasks(overdue: bool = False) -> list[Task]:
    tasks = sorted(_tasks.values(), key=lambda t: t.id)
    if overdue:
        today = date.today()
        tasks = [t for t in tasks if t.due_date is not None and t.due_date < today and not t.done]
    return tasks


@app.post("/tasks", status_code=201)
def create_task(payload: TaskCreate) -> Task:
    global _next_id
    task = Task(id=_next_id, title=payload.title, due_date=payload.due_date)
    _tasks[task.id] = task
    _next_id += 1
    return task


@app.get("/tasks/{task_id}")
def get_task(task_id: int) -> Task:
    task = _tasks.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@app.patch("/tasks/{task_id}")
def update_task(task_id: int, payload: TaskUpdate) -> Task:
    task = _tasks.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    updates = payload.model_dump(exclude_unset=True)
    task = task.model_copy(update=updates)
    _tasks[task_id] = task
    return task


@app.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: int) -> None:
    if task_id not in _tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    del _tasks[task_id]
