"""Data models for TaskFlow.

The Task model is intentionally minimal. Planned extensions (tracked as issues):
- due_date field with overdue queries
"""

from typing import Literal

from pydantic import BaseModel, Field

Priority = Literal["low", "medium", "high"]


class TaskCreate(BaseModel):
    """Payload for creating a task."""

    title: str = Field(min_length=1, max_length=200)
    priority: Priority = "medium"


class TaskUpdate(BaseModel):
    """Payload for updating a task. All fields optional."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    done: bool | None = None
    priority: Priority | None = None


class Task(BaseModel):
    """A task in the system."""

    id: int
    title: str
    done: bool = False
    priority: Priority = "medium"
