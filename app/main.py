"""TaskFlow API - minimal task management service."""

from fastapi import FastAPI, HTTPException

from app.models import Priority, Task, TaskCreate, TaskUpdate

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
def list_tasks(priority: Priority | None = None) -> list[Task]:
    tasks = _tasks.values()
    if priority is not None:
        tasks = [task for task in tasks if task.priority == priority]
    return sorted(tasks, key=lambda t: t.id)


@app.post("/tasks", status_code=201)
def create_task(payload: TaskCreate) -> Task:
    global _next_id
    task = Task(id=_next_id, title=payload.title, priority=payload.priority)
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
