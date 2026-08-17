"""Data models for TaskFlow.

The Task model is intentionally minimal. Planned extensions (tracked as issues):
- priority field (low / medium / high)
- due_date field with overdue queries
"""

from pydantic import BaseModel, Field, model_validator


class TaskCreate(BaseModel):
    """Payload for creating a task."""

    title: str = Field(min_length=1, max_length=200)


class TaskUpdate(BaseModel):
    """Payload for updating a task. All fields optional."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    done: bool | None = None

    @model_validator(mode="before")
    @classmethod
    def reject_explicit_none(cls, data: dict) -> dict:
        for field in ("title", "done"):
            if field in data and data[field] is None:
                raise ValueError(f"'{field}' must not be null")
        return data


class Task(BaseModel):
    """A task in the system."""

    id: int
    title: str
    done: bool = False
