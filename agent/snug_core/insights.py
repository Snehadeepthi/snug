"""Store analytics shared by the manager API and the Insights Agent. No personal or body data is used:
only anonymous scan events (style, sizes, verdict) and try-on feedback (recommended vs kept size)."""
from __future__ import annotations

import time
from collections import Counter, defaultdict

from .db import get_db
from .fit_engine import SIZE_ORDER


def _idx(size: str) -> int:
    return SIZE_ORDER.index(size) if size in SIZE_ORDER else -1


def fit_signals(store_id: str = "", min_responses: int = 3) -> list[dict]:
    """Per style: how often shoppers kept the recommended size, sized up, sized down, and top complaint."""
    db = get_db()
    names = {g["style_id"]: g for g in db.all_garments()}
    fb = defaultdict(list)
    for r in db.list_feedback():
        if store_id and r.get("store_id") != store_id:
            continue
        fb[r["style_id"]].append(r)
    scans = Counter(e["style_id"] for e in db.list_events() if e.get("type") == "scan" and (not store_id or e.get("store_id") == store_id))
    out = []
    for sid, rows in fb.items():
        if len(rows) < min_responses:
            continue
        up = sum(1 for r in rows if _idx(r["kept_size"]) > _idx(r["recommended_size"]))
        down = sum(1 for r in rows if _idx(r["kept_size"]) < _idx(r["recommended_size"]))
        same = len(rows) - up - down
        complaints = Counter(r["fit_rating"] for r in rows if r["fit_rating"] != "perfect")
        g = names.get(sid, {})
        signal = ("runs small" if up / len(rows) >= 0.4 else "runs large" if down / len(rows) >= 0.4
                  else "length issues" if complaints.get("too long", 0) + complaints.get("too short", 0) >= 0.3 * len(rows)
                  else "true to size")
        out.append({"style_id": sid, "name": g.get("name", sid), "category": g.get("category"),
                    "responses": len(rows), "kept_recommended_pct": round(100 * same / len(rows)),
                    "sized_up_pct": round(100 * up / len(rows)), "sized_down_pct": round(100 * down / len(rows)),
                    "top_complaint": complaints.most_common(1)[0][0] if complaints else None,
                    "signal": signal, "live_scans": scans.get(sid, 0),
                    "includes_simulated_history": any(r.get("simulated") for r in rows)})
    out.sort(key=lambda x: (x["signal"] == "true to size", -x["sized_up_pct"] - x["sized_down_pct"]))
    return out


def impact(store_id: str, hours: float = 24) -> dict:
    """Live impact over the last N hours (real app activity only, no simulated data)."""
    db = get_db()
    since = time.time() - hours * 3600
    ev = [e for e in db.list_events(since) if not store_id or e.get("store_id") == store_id]
    scans = [e for e in ev if e.get("type") == "scan"]
    swaps = [e for e in scans if e.get("recommended_size") and e.get("recommended_size") != e.get("scanned_size")]
    tasks = [t for t in db.list_tasks(store_id) if t.get("created", 0) >= since]
    holds = [h for h in db.list_holds(store_id) if h.get("created", 0) >= since]
    return {"hours": hours, "tags_scanned": len(scans), "wrong_size_tryons_avoided": len(swaps),
            "trial_room_trips_saved_est": len(swaps), "staff_requests": len(tasks), "trial_rooms_held": len(holds)}
