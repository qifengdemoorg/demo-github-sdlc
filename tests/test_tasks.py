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


def test_index_serves_ui():
    resp = client.get("/")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/html")
    assert "TaskFlow" in resp.text
    # UI is a Vue 3 single-page app that loads the vendored runtime.
    assert "/static/vendor/vue.global.prod.js" in resp.text


def test_static_serves_vendored_vue():
    resp = client.get("/static/vendor/vue.global.prod.js")
    assert resp.status_code == 200
    assert "javascript" in resp.headers["content-type"]
    assert "Vue" in resp.text


def test_index_missing_ui_returns_404(monkeypatch, tmp_path):
    import app.main as main

    monkeypatch.setattr(main, "_STATIC_DIR", tmp_path)
    resp = client.get("/")
    assert resp.status_code == 404


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
