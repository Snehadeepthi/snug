"""Load data/catalogue.json into Firestore (collection: garments).

Usage (after `gcloud auth application-default login`):
    python scripts/seed_firestore.py --project snug-hack-2026
"""
import argparse
import json
from pathlib import Path

from google.cloud import firestore

DATA = Path(__file__).resolve().parent.parent / "data" / "catalogue.json"

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    args = ap.parse_args()

    db = firestore.Client(project=args.project)
    garments = json.loads(DATA.read_text())
    batch = db.batch()
    for g in garments:
        batch.set(db.collection("garments").document(g["style_id"]), g)
    batch.commit()
    hist_file = DATA.parent / "demo_history.json"
    hist = json.loads(hist_file.read_text()) if hist_file.exists() else []
    for i in range(0, len(hist), 400):
        b = db.batch()
        for row in hist[i:i + 400]:
            b.set(db.collection("feedback").document(), row)
        b.commit()
    print(f"Seeded {len(garments)} garments and {len(hist)} simulated feedback rows into project {args.project}")
