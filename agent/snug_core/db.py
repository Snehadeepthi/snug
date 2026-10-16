"""Data access for Snug. Two interchangeable backends:

  SNUG_BACKEND=local      (default) in-memory, loaded from data/catalogue.json. Zero setup.
  SNUG_BACKEND=firestore  Google Cloud Firestore (run scripts/seed_firestore.py first).

Firestore layout:
  garments/{style_id}                 garment doc incl. sizes and stock {store: {size: qty}}
  stores/{store_id}/holds/{id}        trial-room holds
  stores/{store_id}/tasks/{id}        staff tasks
  feedback/{id}                       anonymous outcomes (no user id, no body data)
"""
from __future__ import annotations

import copy
import json
import os
import threading
import time
import uuid
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
STORES = json.loads((DATA_DIR / "stores.json").read_text())
PROFILES = json.loads((DATA_DIR / "demo_profiles.json").read_text())


def _now() -> float:
    return time.time()


def _demo_history() -> list[dict]:
    """Simulated past try-on feedback (marked simulated=True) so the manager insights have history."""
    f = DATA_DIR / "demo_history.json"
    return json.loads(f.read_text()) if f.exists() else []


class LocalDB:
    def __init__(self):
        self._lock = threading.Lock()
        self.garments = {g["style_id"]: g for g in json.loads((DATA_DIR / "catalogue.json").read_text())}
        self.holds: dict[str, list] = {}
        self.tasks: dict[str, list] = {}
        self.feedback: list = list(_demo_history())
        self.events: list = []

    def list_garments(self) -> list[dict]:
        return [copy.deepcopy(g) for g in self.garments.values() if g.get("status", "approved") == "approved"]

    def all_garments(self) -> list[dict]:
        return [copy.deepcopy(g) for g in self.garments.values()]

    def get_garment(self, style_id: str) -> dict | None:
        g = self.garments.get(style_id)
        return copy.deepcopy(g) if g else None

    def get_by_gtin(self, gtin: str) -> tuple[dict, str] | tuple[None, None]:
        """Find the garment and size for a scanned barcode."""
        for g in self.all_garments():
            for size, code in (g.get("gtins") or {}).items():
                if code == gtin:
                    return g, size
        return None, None

    def save_garment(self, garment: dict) -> None:
        with self._lock:
            self.garments[garment["style_id"]] = copy.deepcopy(garment)

    def add_hold(self, store: str, hold: dict) -> str:
        hid = uuid.uuid4().hex[:8]
        with self._lock:
            self.holds.setdefault(store, []).append({"id": hid, "created": _now(), **hold})
        return hid

    def list_holds(self, store: str) -> list[dict]:
        return list(self.holds.get(store, []))

    def add_task(self, store: str, task: dict) -> str:
        tid = uuid.uuid4().hex[:8]
        with self._lock:
            self.tasks.setdefault(store, []).append({"id": tid, "created": _now(), "status": "open", **task})
        return tid

    def list_tasks(self, store: str) -> list[dict]:
        return sorted(self.tasks.get(store, []), key=lambda t: t["created"], reverse=True)

    def update_task(self, store: str, task_id: str, fields: dict) -> bool:
        with self._lock:
            for t in self.tasks.get(store, []):
                if t["id"] == task_id:
                    t.update(fields)
                    return True
        return False

    def add_feedback(self, row: dict) -> None:
        with self._lock:
            self.feedback.append({"created": _now(), **row})

    def list_feedback(self) -> list[dict]:
        return list(self.feedback)

    def add_event(self, row: dict) -> None:
        with self._lock:
            self.events.append({"created": _now(), **row})

    def list_events(self, since: float = 0) -> list[dict]:
        return [e for e in self.events if e["created"] >= since]


class FirestoreDB:
    def __init__(self):
        from google.cloud import firestore  # imported lazily so local mode needs no GCP libs
        self.fs = firestore
        self.db = firestore.Client(project=os.environ.get("GOOGLE_CLOUD_PROJECT"))
        self._cache: dict | None = None
        self._cache_t = 0.0

    def _garments(self) -> dict:
        # small catalogue: cache for 30 s to keep the agent fast
        if self._cache is None or _now() - self._cache_t > 30:
            self._cache = {d.id: d.to_dict() for d in self.db.collection("garments").stream()}
            self._cache_t = _now()
        return self._cache

    def list_garments(self) -> list[dict]:
        return [copy.deepcopy(g) for g in self._garments().values() if g.get("status", "approved") == "approved"]

    def all_garments(self) -> list[dict]:
        return [copy.deepcopy(g) for g in self._garments().values()]

    def get_garment(self, style_id: str) -> dict | None:
        doc = self.db.collection("garments").document(style_id).get()
        return doc.to_dict() if doc.exists else None

    def get_by_gtin(self, gtin: str) -> tuple[dict, str] | tuple[None, None]:
        """Find the garment and size for a scanned barcode."""
        for g in self.all_garments():
            for size, code in (g.get("gtins") or {}).items():
                if code == gtin:
                    return g, size
        return None, None

    def save_garment(self, garment: dict) -> None:
        self.db.collection("garments").document(garment["style_id"]).set(garment)
        self._cache = None

    def add_hold(self, store: str, hold: dict) -> str:
        ref = self.db.collection("stores").document(store).collection("holds").document()
        ref.set({"created": _now(), **hold})
        return ref.id

    def list_holds(self, store: str) -> list[dict]:
        return [{"id": d.id, **d.to_dict()} for d in
                self.db.collection("stores").document(store).collection("holds").stream()]

    def add_task(self, store: str, task: dict) -> str:
        ref = self.db.collection("stores").document(store).collection("tasks").document()
        ref.set({"created": _now(), "status": "open", **task})
        return ref.id

    def list_tasks(self, store: str) -> list[dict]:
        docs = self.db.collection("stores").document(store).collection("tasks").stream()
        return sorted(({"id": d.id, **d.to_dict()} for d in docs), key=lambda t: t["created"], reverse=True)

    def update_task(self, store: str, task_id: str, fields: dict) -> bool:
        ref = self.db.collection("stores").document(store).collection("tasks").document(task_id)
        if not ref.get().exists:
            return False
        ref.update(fields)
        return True

    def add_feedback(self, row: dict) -> None:
        self.db.collection("feedback").add({"created": _now(), **row})

    def list_feedback(self) -> list[dict]:
        return [d.to_dict() for d in self.db.collection("feedback").stream()]

    def add_event(self, row: dict) -> None:
        self.db.collection("events").add({"created": _now(), **row})

    def list_events(self, since: float = 0) -> list[dict]:
        q = self.db.collection("events").where(filter=self.fs.FieldFilter("created", ">=", since))
        return [d.to_dict() for d in q.stream()]


_db = None


def get_db():
    global _db
    if _db is None:
        _db = FirestoreDB() if os.environ.get("SNUG_BACKEND", "local").lower() == "firestore" else LocalDB()
    return _db
