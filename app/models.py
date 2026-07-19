"""Data models for TaskFlow."""

from datetime import date
from enum import StrEnum

from pydantic import BaseModel, Field


class Priority(StrEnum):
    """Task priority levels."""

    low = "low"
    medium = "medium"
    high = "high"


class TaskCreate(BaseModel):
    """Payload for creating a task."""

    title: str = Field(min_length=1, max_length=200)
    priority: Priority = Priority.medium
    due_date: date | None = None


class TaskUpdate(BaseModel):
    """Payload for updating a task. All fields optional."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    done: bool | None = None
    priority: Priority | None = None
    due_date: date | None = None


class Task(BaseModel):
    """A task in the system."""

    id: int
    title: str
    done: bool = False
    priority: Priority = Priority.medium
    due_date: date | None = None

    def is_overdue(self, today: date) -> bool:
        """A task is overdue when it has a past due date and is not done."""
        return self.due_date is not None and self.due_date < today and not self.done
