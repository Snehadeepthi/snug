"""Run:  pytest -q   (from the agent/ folder)"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from snug_core.fit_engine import evaluate_size, recommend  # noqa: E402

CAT = {g["style_id"]: g for g in json.loads((ROOT / "data" / "catalogue.json").read_text())}
PROFILES = json.loads((ROOT / "data" / "demo_profiles.json").read_text())
ANANYA, ROHAN = PROFILES["ananya"], PROFILES["rohan"]


def test_regular_kurta_picks_m_for_ananya():
    r = recommend(ANANYA, CAT["W01"])
    assert r["verdict"] == "fits" and r["size"] == "M"


def test_size_below_is_tight():
    s = evaluate_size(ANANYA, CAT["W01"], "S")
    assert any(p["status"] == "tight" for p in s["points"])


def test_regular_kurta_is_long_but_petite_is_not():
    regular = recommend(ANANYA, CAT["W01"])
    petite = recommend(ANANYA, CAT["W02"])
    assert any("long" in n for n in regular["notes"])
    assert not any("long" in n for n in petite["notes"])


def test_stretch_helps_tight_jeans():
    tight_profile = {**ANANYA, "waist": 70.5}
    no_stretch = {**CAT["W07"], "stretch_pct": 0}
    a = evaluate_size(tight_profile, no_stretch, "26")
    b = evaluate_size(tight_profile, CAT["W07"], "26")
    assert b["score"] <= a["score"]


def test_relaxed_preference_never_picks_smaller_size():
    order = list(CAT["W05"]["sizes"])
    reg = recommend(ANANYA, CAT["W05"], "regular")["size"]
    rel = recommend(ANANYA, CAT["W05"], "relaxed")["size"]
    assert order.index(rel) >= order.index(reg)


def test_no_good_fit_for_extreme_body():
    giant = {"chest": 150, "waist": 140, "hip": 150, "height": 190, "inseam": 90}
    assert recommend(giant, CAT["W04"])["verdict"] == "no_good_fit"


def test_mens_kurta_for_rohan_fits():
    r = recommend(ROHAN, CAT["M01"])
    assert r["verdict"] == "fits" and r["size"] in ("M", "L")


def test_never_returns_body_numbers():
    r = recommend(ANANYA, CAT["W03"])
    flat = json.dumps(r)
    assert "88" not in flat and "chest\": 88" not in flat


def test_sitting_check_moves_rigid_jeans_up_a_size():
    # Size 28 fits standing, but the waist and hip dig in when seated, so 30 is recommended
    standing = evaluate_size(ANANYA, CAT["W11"], "28")
    assert all(p["status"] == "ok" for p in standing["points"])
    assert any(p["status"] == "tight_sitting" for p in standing["seated_points"])
    r = recommend(ANANYA, CAT["W11"])
    assert r["size"] == "30" and r["sitting"] == "comfortable"


def test_sitting_estimated_without_seated_photo():
    p = {k: v for k, v in ANANYA.items() if not k.startswith("seated_")}
    assert recommend(p, CAT["W11"])["sitting_estimated"] is True


def test_kurta_sitting_check_comfortable():
    assert recommend(ANANYA, CAT["W01"])["sitting"] == "comfortable"


def test_sitting_check_on_shirts_pulls_at_buttons():
    rohan = PROFILES["rohan"]
    m = evaluate_size(rohan, CAT["M11"], "M")
    assert all(p["status"] == "ok" for p in m["points"])              # fits standing
    assert any(p["status"] == "tight_sitting" for p in m["seated_points"])
    assert recommend(rohan, CAT["M11"])["size"] == "L"


def test_regular_shirts_not_flagged_when_sitting():
    assert recommend(PROFILES["rohan"], CAT["M04"])["sitting"] == "comfortable"
    assert recommend(PROFILES["rohan"], CAT["M03"])["sitting"] == "comfortable"
