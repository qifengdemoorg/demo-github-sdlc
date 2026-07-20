"""Data models for TaskFlow.

The Task model is intentionally minimal. Planned extensions (tracked as issues):
- priority field (low / medium / high)
"""

from datetime import date

from pydantic import BaseModel, Field


class TaskCreate(BaseModel):
    """Payload for creating a task."""

    title: str = Field(min_length=1, max_length=200)
    due_date: date | None = None


class TaskUpdate(BaseModel):
    """Payload for updating a task. All fields optional."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    done: bool | None = None
    due_date: date | None = None


class Task(BaseModel):
    """A task in the system."""

    id: int
    title: str
    done: bool = False
    due_date: date | None = None
