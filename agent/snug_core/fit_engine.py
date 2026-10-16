"""Snug fit engine: deterministic rules + math. This decides sizes, not the LLM.

All measurements are in centimetres.
Body profile example:   {"chest": 88, "waist": 72, "hip": 96, "height": 162, "inseam": 74}
Garment example:        {"category": "kurta", "fit_type": "regular", "stretch_pct": 0,
                         "sizes": {"S": {"chest": 96, "waist": 88, "hip": 102, "length": 108}, ...}}
"""
from __future__ import annotations

SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL", "26", "28", "30", "32", "34", "36", "38", "40"]

# Target ease (extra room over the body) per category + fit type, in cm.
EASE = {
    ("kurta", "regular"): {"chest": 10, "waist": 12, "hip": 12},
    ("kurta", "slim"): {"chest": 6, "waist": 6, "hip": 8},
    ("shirt", "slim"): {"chest": 8, "waist": 8},
    ("shirt", "regular"): {"chest": 12, "waist": 14},
    ("tshirt", "regular"): {"chest": 8},
    ("tshirt", "oversized"): {"chest": 18},
    ("dress", "fitted"): {"chest": 5, "waist": 4, "hip": 5},
    ("dress", "relaxed"): {"chest": 10, "waist": 12, "hip": 12},
    ("jeans", "slim"): {"waist": 1, "hip": 3},
    ("jeans", "regular"): {"waist": 2, "hip": 6},
    ("trousers", "regular"): {"waist": 2.5, "hip": 6},
    ("blazer", "regular"): {"chest": 10, "waist": 10},
}

# How much each point of measure matters for the overall verdict.
WEIGHTS = {
    "kurta": {"chest": 0.35, "waist": 0.2, "hip": 0.25, "length": 0.2},
    "shirt": {"chest": 0.5, "waist": 0.3, "length": 0.2},
    "tshirt": {"chest": 0.7, "length": 0.3},
    "dress": {"chest": 0.3, "waist": 0.3, "hip": 0.25, "length": 0.15},
    "jeans": {"waist": 0.5, "hip": 0.3, "inseam": 0.2},
    "trousers": {"waist": 0.5, "hip": 0.3, "inseam": 0.2},
    "blazer": {"chest": 0.55, "waist": 0.25, "length": 0.2},
}

# Ideal garment length as a fraction of body height (tops/dresses).
LENGTH_RATIO = {"kurta": 0.61, "shirt": 0.43, "tshirt": 0.40, "dress": 0.56, "blazer": 0.43}

TIGHT_TOL = -1.5          # cm below target before it feels tight
LOOSE_TOL = {"default": 6.0, "oversized": 10.0}
LENGTH_TOL = 5.0          # cm either side of the ideal length
COMFORT = 0.45            # share of fabric stretch that is comfortable to use
PREFERENCE_SHIFT = {"snug": -2.0, "regular": 0.0, "relaxed": 3.0}

# Sitting-posture check: waist and hip grow when you sit, and tops ride up at the back.
# Measured from the optional sitting photo (profile["seated_waist"/"seated_hip"]); otherwise estimated.
SEATED_WEIGHTS = {
    "jeans": {"waist": 0.4, "hip": 0.3}, "trousers": {"waist": 0.4, "hip": 0.3},
    "shirt": {"waist": 0.3, "length": 0.15}, "tshirt": {"length": 0.15}, "blazer": {"waist": 0.3},
    "kurta": {"waist": 0.2, "hip": 0.2}, "dress": {"waist": 0.3, "hip": 0.2},
}
SEATED_DEFAULT_GAIN = {"waist": 3.0, "hip": 4.0}
# Minimum room needed while seated (cm): bottoms just must not dig in; shirts need room so buttons don't pull.
SEATED_EASE = {
    "jeans": {"waist": 0.0, "hip": 1.0}, "trousers": {"waist": 0.0, "hip": 1.0},
    "shirt|slim": {"waist": 6.0}, "shirt|regular": {"waist": 8.0}, "blazer": {"waist": 6.0},
    "kurta|slim": {"waist": 4.0, "hip": 3.0}, "kurta|regular": {"waist": 6.0, "hip": 4.0},
    "dress|fitted": {"waist": 1.0, "hip": 1.0}, "dress|relaxed": {"waist": 6.0, "hip": 4.0},
}
SEATED_LENGTH_RISE = 3.0     # a top rides up about this much at the back when you sit
SEATED_SHORT_TOL = -6.0     # only flags tops that are already on the short side
SEATED_TIGHT_TOL = -1.0
SEATED_COMFORT = 0.6         # stretch gives a bit more when seated


def _seated_ease(cat: str, fit: str, pom: str) -> float:
    return (SEATED_EASE.get(f"{cat}|{fit}") or SEATED_EASE.get(cat) or {}).get(pom, 0.0)


def seated_body(profile: dict, pom: str) -> tuple[float | None, bool]:
    """Seated measurement for waist/hip and whether it was estimated."""
    v = profile.get(f"seated_{pom}")
    if v:
        return v, False
    base = profile.get(pom)
    return (base + SEATED_DEFAULT_GAIN[pom], True) if base else (None, True)


def _target_ease(category: str, fit_type: str, pom: str, preference: str) -> float:
    base = EASE.get((category, fit_type)) or EASE.get((category, "regular")) or {}
    return base.get(pom, 4.0) + PREFERENCE_SHIFT.get(preference, 0.0)


def _length_target(category: str, profile: dict, pom: str) -> float | None:
    if pom == "inseam":
        return profile.get("inseam")
    if pom == "length" and profile.get("height") and category in LENGTH_RATIO:
        return round(profile["height"] * LENGTH_RATIO[category], 1)
    return None


def evaluate_size(profile: dict, garment: dict, size_label: str, preference: str = "regular") -> dict:
    """Compare one size of a garment with the body. Returns per-point results and a score (0 = perfect)."""
    cat, fit = garment["category"], garment.get("fit_type", "regular")
    stretch = garment.get("stretch_pct", 0) or 0
    spec = garment["sizes"][size_label]
    weights = WEIGHTS.get(cat, {})
    loose_tol = LOOSE_TOL["oversized"] if fit == "oversized" else LOOSE_TOL["default"]

    points, score = [], 0.0
    for pom, w in weights.items():
        if pom not in spec:
            continue
        g = spec[pom]
        if pom in ("length", "inseam"):
            target = _length_target(cat, profile, pom)
            if target is None:
                continue
            delta = round(g - target, 1)
            status = "long" if delta > LENGTH_TOL else "short" if delta < -LENGTH_TOL else "ok"
            score += w * max(0.0, abs(delta) - LENGTH_TOL / 2) * 0.6
        else:
            body = profile.get(pom)
            if body is None:
                continue
            target = body + _target_ease(cat, fit, pom, preference)
            delta = g - target
            if delta < 0 and stretch:
                delta = g * (1 + COMFORT * stretch / 100) - target
            delta = round(delta, 1)
            status = "tight" if delta < TIGHT_TOL else "loose" if delta > loose_tol else "ok"
            if delta < 0:
                score += w * 2.0 * abs(delta)          # tightness hurts more than looseness
            elif delta > loose_tol / 2:
                score += w * (delta - loose_tol / 2)
        points.append({"pom": pom, "delta_cm": delta, "status": status})

    seated_points = []
    for pom, w in SEATED_WEIGHTS.get(cat, {}).items():
        if pom not in spec:
            continue
        g = spec[pom]
        if pom == "length":
            target = _length_target(cat, profile, pom)
            if target is None:
                continue
            delta = round(g - (target + SEATED_LENGTH_RISE), 1)
            status = "short_sitting" if delta < SEATED_SHORT_TOL else "ok"
            if delta < SEATED_SHORT_TOL:
                score += w * 0.6 * (SEATED_SHORT_TOL - delta)
            seated_points.append({"pom": pom, "delta_cm": delta, "status": status, "estimated": False})
            continue
        body_s, estimated = seated_body(profile, pom)
        if body_s is None:
            continue
        delta = round(g * (1 + SEATED_COMFORT * stretch / 100) - (body_s + _seated_ease(cat, fit, pom)), 1)
        status = "tight_sitting" if delta < SEATED_TIGHT_TOL else "ok"
        if delta < 0:
            score += w * 3.0 * abs(delta)            # digging in / buttons pulling when you sit
        seated_points.append({"pom": pom, "delta_cm": delta, "status": status, "estimated": estimated})
    return {"size": size_label, "score": round(score, 2), "points": points, "seated_points": seated_points}


def _note(p: dict) -> str:
    inches = abs(p["delta_cm"]) / 2.54
    if p["status"] == "tight_sitting":
        return f"{p['pom']} about {inches:.1f} in tight when sitting"
    if p["status"] == "short_sitting":
        return f"rides up about {inches:.1f} in when sitting"
    word = {"tight": "tight", "loose": "loose", "long": "long", "short": "short"}[p["status"]]
    return f"{p['pom']} about {inches:.1f} in {word}"


def _issues(r: dict) -> list[str]:
    return [_note(p) for p in r["points"] + r.get("seated_points", []) if p["status"] != "ok"]


def recommend(profile: dict, garment: dict, preference: str = "regular") -> dict:
    """Pick the best size for this body. This is what the agent's get_fit_verdicts tool returns."""
    sizes = sorted(garment["sizes"].keys(),
                   key=lambda s: SIZE_ORDER.index(s) if s in SIZE_ORDER else 99)
    results = sorted((evaluate_size(profile, garment, s, preference) for s in sizes),
                     key=lambda r: r["score"])
    best = results[0]
    runner_up = results[1] if len(results) > 1 else None
    tight = [p for p in best["points"] if p["status"] == "tight"]
    if tight:
        verdict, confidence = "no_good_fit", "high"
    else:
        verdict = "fits"
        confidence = "high" if not runner_up or runner_up["score"] - best["score"] > 1.5 else "medium"

    other_notes = {}
    for r in results[1:3]:
        issues = _issues(r)
        if issues:
            other_notes[r["size"]] = issues
    return {
        "verdict": verdict,
        "size": best["size"],
        "confidence": confidence,
        "notes": _issues(best),
        "sitting": (None if not best.get("seated_points") else
                    "tight" if any(p["status"] != "ok" for p in best["seated_points"]) else "comfortable"),
        "sitting_estimated": any(p.get("estimated") for p in best.get("seated_points", [])) or None,
        "between_sizes": runner_up["size"] if confidence == "medium" and runner_up else None,
        "other_sizes": other_notes,
    }
