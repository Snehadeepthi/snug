"""Welcome email endpoint: verifies the Firebase token, emails only that account, once. Run: pytest -q"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("SNUG_MODEL", "gemini-3.5-flash")
os.environ.setdefault("GOOGLE_CLOUD_PROJECT", "snug-test")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from snug_core import mailer  # noqa: E402

SENT = []


class FakeSMTP:
    def __init__(self, *a, **k): pass
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def starttls(self): pass
    def login(self, u, p): assert p == "abcdefghijklmnop"        # spaces in the App Password are removed
    def send_message(self, m): SENT.append(m)


@pytest.fixture()
def client(monkeypatch):
    SENT.clear(); main._welcomed.clear()
    monkeypatch.setenv("SNUG_SMTP_USER", "snug.team@gmail.com")
    monkeypatch.setenv("SNUG_SMTP_PASS", "abcd efgh ijkl mnop")
    monkeypatch.setattr(mailer.smtplib, "SMTP", FakeSMTP)
    from google.oauth2 import id_token
    def verify(tok, req, audience=None):
        if tok == "good-token":
            return {"sub": "uid-1", "email": "meera@example.com", "name": "Meera"}
        raise ValueError("bad token")
    monkeypatch.setattr(id_token, "verify_firebase_token", verify)
    return TestClient(main.app)


def test_sends_personal_welcome_once(client):
    r = client.post("/api/welcome-email", json={"id_token": "good-token", "name": "ignored"})
    assert r.status_code == 200 and len(SENT) == 1
    m = SENT[0]
    assert m["To"] == "meera@example.com" and m["Subject"] == "Welcome to Snug, Meera! Your account is created"
    assert "Welcome to Snug, Meera!" in m.get_body(("html",)).get_content()
    assert client.post("/api/welcome-email", json={"id_token": "good-token"}).json()["already_sent"] is True
    assert len(SENT) == 1


def test_rejects_bad_token(client):
    assert client.post("/api/welcome-email", json={"id_token": "forged"}).status_code == 401 and not SENT


def test_not_configured_returns_503(client, monkeypatch):
    monkeypatch.delenv("SNUG_SMTP_PASS")
    assert client.post("/api/welcome-email", json={"id_token": "good-token"}).status_code == 503
