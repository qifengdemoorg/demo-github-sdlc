"""Tests for the TaskFlow API."""

import pytest
from fastapi.testclient import TestClient

from app.main import app, reset_store

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clean_store():
    reset_store()
    yield


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_create_task():
    resp = client.post("/tasks", json={"title": "Write demo script"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["id"] == 1
    assert body["title"] == "Write demo script"
    assert body["done"] is False


def test_create_task_rejects_empty_title():
    resp = client.post("/tasks", json={"title": ""})
    assert resp.status_code == 422


def test_list_tasks():
    client.post("/tasks", json={"title": "First"})
    client.post("/tasks", json={"title": "Second"})
    resp = client.get("/tasks")
    assert resp.status_code == 200
    titles = [t["title"] for t in resp.json()]
    assert titles == ["First", "Second"]


def test_get_task():
    client.post("/tasks", json={"title": "Find me"})
    resp = client.get("/tasks/1")
    assert resp.status_code == 200
    assert resp.json()["title"] == "Find me"


def test_get_missing_task_returns_404():
    resp = client.get("/tasks/999")
    assert resp.status_code == 404


def test_update_task():
    client.post("/tasks", json={"title": "Original"})
    resp = client.patch("/tasks/1", json={"title": "Renamed", "done": True})
    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "Renamed"
    assert body["done"] is True


def test_delete_task():
    client.post("/tasks", json={"title": "Remove me"})
    resp = client.delete("/tasks/1")
    assert resp.status_code == 204
    assert client.get("/tasks/1").status_code == 404


# --- due_date tests ---


def test_create_task_with_due_date():
    resp = client.post("/tasks", json={"title": "Dated task", "due_date": "2026-08-01"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["due_date"] == "2026-08-01"


def test_create_task_without_due_date_defaults_to_null():
    resp = client.post("/tasks", json={"title": "No date"})
    assert resp.status_code == 201
    assert resp.json()["due_date"] is None


def test_create_task_with_past_due_date_allowed():
    resp = client.post("/tasks", json={"title": "Old task", "due_date": "2020-01-01"})
    assert resp.status_code == 201
    assert resp.json()["due_date"] == "2020-01-01"


def test_update_task_sets_due_date():
    client.post("/tasks", json={"title": "No date yet"})
    resp = client.patch("/tasks/1", json={"due_date": "2026-09-15"})
    assert resp.status_code == 200
    assert resp.json()["due_date"] == "2026-09-15"


def test_update_task_clears_due_date():
    client.post("/tasks", json={"title": "Has date", "due_date": "2026-08-01"})
    resp = client.patch("/tasks/1", json={"due_date": None})
    assert resp.status_code == 200
    assert resp.json()["due_date"] is None


def test_overdue_filter_returns_only_overdue_incomplete_tasks():
    # overdue and not done — should appear
    client.post("/tasks", json={"title": "Overdue task", "due_date": "2020-01-01"})
    # overdue but done — should NOT appear
    client.post("/tasks", json={"title": "Overdue done", "due_date": "2020-01-01"})
    client.patch("/tasks/2", json={"done": True})
    # future due date — should NOT appear
    client.post("/tasks", json={"title": "Future task", "due_date": "2099-12-31"})
    # no due date — should NOT appear
    client.post("/tasks", json={"title": "No due date"})

    resp = client.get("/tasks?overdue=true")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["title"] == "Overdue task"


def test_overdue_false_returns_all_tasks():
    client.post("/tasks", json={"title": "Task A", "due_date": "2020-01-01"})
    client.post("/tasks", json={"title": "Task B"})
    resp = client.get("/tasks?overdue=false")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_overdue_filter_invalid_value_returns_422():
    resp = client.get("/tasks?overdue=notabool")
    assert resp.status_code == 422
