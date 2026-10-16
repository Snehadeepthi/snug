"""Generates SIMULATED past try-on feedback -> data/demo_history.json (clearly marked simulated=True).

Patterns built in for the demo: W10 Maroon Velvet Kurta and M03 Sage Oxford Shirt run small;
W01 regular kurta is often too long (petite W02 fixes it); M07 oversized tee runs large.
"""
import json
import random
import time
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
random.seed(11)
cat = {g["style_id"]: g for g in json.loads((DATA / "catalogue.json").read_text())}
now = time.time()
BIAS = {"W10": ("up", 0.75), "M03": ("up", 0.6), "W01": ("long", 0.5), "M07": ("down", 0.55), "W07": ("same", 0.9)}
rows = []
for sid, g in cat.items():
    sizes = list(g["sizes"])
    for _ in range(random.randint(8, 22)):
        i = random.randint(0, len(sizes) - 2)
        rec = sizes[i]
        kind, p = BIAS.get(sid, ("same", 0.8))
        kept, rating = rec, "perfect"
        r = random.random()
        if kind == "up" and r < p:
            kept, rating = sizes[min(i + 1, len(sizes) - 1)], "too tight"
        elif kind == "down" and r < p:
            kept, rating = sizes[max(i - 1, 0)], "too loose"
        elif kind == "long" and r < p:
            rating = "too long"
        elif kind == "same" and r > p:
            kept, rating = random.choice([(sizes[min(i + 1, len(sizes) - 1)], "too tight"), (rec, "too loose")])
        rows.append({"style_id": sid, "recommended_size": rec, "kept_size": kept, "fit_rating": rating,
                     "store_id": random.choice(["BLR-07", "BLR-07", "BLR-12"]),
                     "created": now - random.randint(1, 30) * 86400, "simulated": True})
# extra simulated history for the other metro stores (separate generator so the rows above never change)
stores = [k for k in json.loads((DATA / "stores.json").read_text()) if k not in ("BLR-07", "BLR-12")]
rng = random.Random(23)
for st in stores:
    for sid, g in cat.items():
        sizes = list(g["sizes"])
        for _ in range(rng.randint(6, 10)):
            i = rng.randint(0, len(sizes) - 2); rec = sizes[i]
            kind, p = BIAS.get(sid, ("same", 0.93)); kept, rating = rec, "perfect"; r = rng.random()
            if kind == "up" and r < p: kept, rating = sizes[min(i + 1, len(sizes) - 1)], "too tight"
            elif kind == "down" and r < p: kept, rating = sizes[max(i - 1, 0)], "too loose"
            elif kind == "long" and r < p: rating = "too long"
            elif kind == "same" and r > p: kept, rating = sizes[min(i + 1, len(sizes) - 1)], "too tight"
            rows.append({"style_id": sid, "recommended_size": rec, "kept_size": kept, "fit_rating": rating,
                         "store_id": st, "created": now - rng.randint(1, 30) * 86400, "simulated": True})
(DATA / "demo_history.json").write_text(json.dumps(rows, indent=0))
print(f"Wrote {len(rows)} simulated feedback rows")
