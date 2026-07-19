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


def test_create_task_default_priority():
    resp = client.post("/tasks", json={"title": "Default priority"})
    assert resp.status_code == 201
    assert resp.json()["priority"] == "medium"


def test_create_task_with_priority():
    resp = client.post("/tasks", json={"title": "Urgent", "priority": "high"})
    assert resp.status_code == 201
    assert resp.json()["priority"] == "high"


def test_create_task_rejects_invalid_priority():
    resp = client.post("/tasks", json={"title": "Bad", "priority": "urgent"})
    assert resp.status_code == 422


def test_update_task_priority():
    client.post("/tasks", json={"title": "Task"})
    resp = client.patch("/tasks/1", json={"priority": "low"})
    assert resp.status_code == 200
    assert resp.json()["priority"] == "low"


def test_list_tasks_filtered_by_priority():
    client.post("/tasks", json={"title": "A", "priority": "high"})
    client.post("/tasks", json={"title": "B", "priority": "low"})
    client.post("/tasks", json={"title": "C", "priority": "high"})
    resp = client.get("/tasks", params={"priority": "high"})
    assert resp.status_code == 200
    titles = [t["title"] for t in resp.json()]
    assert titles == ["A", "C"]


def test_list_tasks_rejects_invalid_priority_filter():
    resp = client.get("/tasks", params={"priority": "nope"})
    assert resp.status_code == 422


def test_create_task_with_due_date():
    resp = client.post("/tasks", json={"title": "Deadline", "due_date": "2026-08-01"})
    assert resp.status_code == 201
    assert resp.json()["due_date"] == "2026-08-01"


def test_create_task_without_due_date():
    resp = client.post("/tasks", json={"title": "No deadline"})
    assert resp.status_code == 201
    assert resp.json()["due_date"] is None


def test_create_task_rejects_invalid_due_date():
    resp = client.post("/tasks", json={"title": "Bad", "due_date": "not-a-date"})
    assert resp.status_code == 422


def test_update_task_due_date():
    client.post("/tasks", json={"title": "Task"})
    resp = client.patch("/tasks/1", json={"due_date": "2030-01-01"})
    assert resp.status_code == 200
    assert resp.json()["due_date"] == "2030-01-01"


def test_list_overdue_tasks():
    client.post("/tasks", json={"title": "Past", "due_date": "2020-01-01"})
    client.post("/tasks", json={"title": "Future", "due_date": "2999-12-31"})
    client.post("/tasks", json={"title": "PastDone", "due_date": "2020-01-01"})
    client.patch("/tasks/3", json={"done": True})
    resp = client.get("/tasks", params={"overdue": "true"})
    assert resp.status_code == 200
    titles = [t["title"] for t in resp.json()]
    assert titles == ["Past"]


def test_overdue_filter_combines_with_priority():
    client.post("/tasks", json={"title": "A", "priority": "high", "due_date": "2020-01-01"})
    client.post("/tasks", json={"title": "B", "priority": "low", "due_date": "2020-01-01"})
    resp = client.get("/tasks", params={"overdue": "true", "priority": "high"})
    titles = [t["title"] for t in resp.json()]
    assert titles == ["A"]
