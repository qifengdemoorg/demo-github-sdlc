"""Tests for the TaskFlow API."""

import pytest
from fastapi.testclient import TestClient

from app.main import app, reset_store
from app.models import NULL_PRIORITY_ERROR

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
    assert body["priority"] == "medium"


def test_create_task_with_priority():
    resp = client.post("/tasks", json={"title": "Urgent fix", "priority": "high"})
    assert resp.status_code == 201
    assert resp.json()["priority"] == "high"


def test_create_task_rejects_empty_title():
    resp = client.post("/tasks", json={"title": ""})
    assert resp.status_code == 422


def test_create_task_rejects_invalid_priority():
    resp = client.post("/tasks", json={"title": "Write docs", "priority": "urgent"})
    assert resp.status_code == 422


def test_list_tasks():
    client.post("/tasks", json={"title": "First"})
    client.post("/tasks", json={"title": "Second"})
    resp = client.get("/tasks")
    assert resp.status_code == 200
    titles = [t["title"] for t in resp.json()]
    assert titles == ["First", "Second"]


def test_list_tasks_filters_by_priority():
    client.post("/tasks", json={"title": "Low task", "priority": "low"})
    client.post("/tasks", json={"title": "High task", "priority": "high"})
    client.post("/tasks", json={"title": "Default task"})

    resp = client.get("/tasks?priority=high")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["title"] == "High task"
    assert body[0]["priority"] == "high"


def test_list_tasks_rejects_invalid_priority_filter():
    resp = client.get("/tasks?priority=urgent")
    assert resp.status_code == 422


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
    resp = client.patch(
        "/tasks/1",
        json={"title": "Renamed", "done": True, "priority": "low"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "Renamed"
    assert body["done"] is True
    assert body["priority"] == "low"


def test_update_task_rejects_invalid_priority():
    client.post("/tasks", json={"title": "Original"})
    resp = client.patch("/tasks/1", json={"priority": "urgent"})
    assert resp.status_code == 422


def test_update_task_rejects_null_priority():
    client.post("/tasks", json={"title": "Original"})
    resp = client.patch("/tasks/1", json={"priority": None})
    assert resp.status_code == 422
    assert resp.json()["detail"] == [
        {
            "type": "value_error",
            "loc": ["body", "priority"],
            "msg": NULL_PRIORITY_ERROR,
            "input": None,
        }
    ]
    assert client.get("/tasks/1").json()["priority"] == "medium"


def test_delete_task():
    client.post("/tasks", json={"title": "Remove me"})
    resp = client.delete("/tasks/1")
    assert resp.status_code == 204
    assert client.get("/tasks/1").status_code == 404
