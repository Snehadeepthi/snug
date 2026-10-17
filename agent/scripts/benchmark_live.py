"""Benchmark the deployed Snug prototype (API latency + real Gemini agent turns). Standard library only.

Run in Cloud Shell from the agent/ folder:
    python3 scripts/benchmark_live.py https://snug-5zcsxlm5za-el.a.run.app
It uses the Whitefield store (BLR-21) so the Indiranagar demo screens stay clean.
"""
import json, statistics, sys, time, urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from snug_core.fit_engine import recommend  # noqa: E402

BASE = (sys.argv[1] if len(sys.argv) > 1 else "https://snug-5zcsxlm5za-el.a.run.app").rstrip("/")
RUNS = int(sys.argv[2]) if len(sys.argv) > 2 else 3
STORE = "BLR-21"


def req(path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, headers={"Content-Type": "application/json"}, method="POST" if data else "GET")
    t = time.perf_counter()
    with urllib.request.urlopen(r, timeout=120) as resp:
        raw = resp.read()
    return (time.perf_counter() - t) * 1000, raw


def pct(xs, p):
    xs = sorted(xs); return round(xs[min(len(xs) - 1, int(len(xs) * p))], 0)


print(f"Benchmarking {BASE}\n")
for name, path in [("status", "/api/status"), ("barcode lookup", "/api/garments/by-gtin/2026010010004"), ("catalogue", "/api/garments")]:
    xs = [req(path)[0] for _ in range(20)]
    print(f"{name:16s} p50 {pct(xs, .5):5.0f} ms   p95 {pct(xs, .95):5.0f} ms")

cfg = json.loads(req("/api/config")[1])
garments = json.loads(req("/api/garments")[1])
profile = cfg["profiles"]["ananya"]
verdicts = {g["style_id"]: {"name": g["name"], **recommend(profile, g)} for g in garments}   # what the phone sends
w10 = next(g for g in garments if g["style_id"] == "W10")
state = {"store_id": STORE, "gender": "women", "language": "English", "fit_verdicts": verdicts, "shopping_for": "Ananya",
         "scanned": {"style_id": "W10", "name": w10["name"], "scanned_size": "M", "recommended_size": verdicts["W10"]["size"]}}


def turn(uid, sid, text):
    body = {"app_name": "snug_agent", "user_id": uid, "session_id": sid, "new_message": {"role": "user", "parts": [{"text": text}]},
            "streaming": False, "state_delta": state}
    r = urllib.request.Request(BASE + "/run_sse", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
    t0 = time.perf_counter(); first = None; tools, reply = [], ""
    with urllib.request.urlopen(r, timeout=180) as resp:
        for line in resp:
            if first is None: first = time.perf_counter() - t0
            line = line.decode().strip()
            if not line.startswith("data: "): continue
            ev = json.loads(line[6:])
            for p in (ev.get("content") or {}).get("parts") or []:
                if p.get("functionCall"): tools.append(p["functionCall"]["name"])
                if p.get("text") and not ev.get("partial") and not p.get("thought"): reply = p["text"]
    return time.perf_counter() - t0, first or 0, tools, reply


t1s, t2s, ok = [], [], 0
for i in range(RUNS):
    uid = f"bench-{int(time.time())}-{i}"
    sid = json.loads(req(f"/apps/snug_agent/users/{uid}/sessions", {"state": state})[1])["id"]
    a = turn(uid, sid, "I scanned the Maroon Velvet Kurta in size M. Please get me size L.")
    b = turn(uid, sid, "Yes please, hold it and ask staff to bring it.")
    t1s.append(a[0]); t2s.append(b[0])
    right = "check_stock" in a[2] and "reserve_trial_room" in b[2] and "notify_staff" in b[2] and " L" in (a[3] + b[3])
    ok += right
    print(f"\nRun {i+1}: turn 1 {a[0]:.1f}s tools={a[2]}\n        turn 2 {b[0]:.1f}s tools={b[2]}\n        reply: {b[3][:110]!r}")
    time.sleep(2)

print(f"\nAgent turn 1 (verdict -> stock): median {statistics.median(t1s):.1f}s  max {max(t1s):.1f}s")
print(f"Agent turn 2 (hold + staff):     median {statistics.median(t2s):.1f}s  max {max(t2s):.1f}s")
print(f"Correct end-to-end actions: {ok}/{RUNS} (stock checked, room held, staff notified, size L)")
