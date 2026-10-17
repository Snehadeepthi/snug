"""Guardrails that stop the agent acting on a size the fit engine didn't recommend. Run: pytest -q"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from apps.snug_agent import tools as T  # noqa: E402
from snug_core.fit_engine import recommend  # noqa: E402

CAT = {g["style_id"]: g for g in json.loads((ROOT / "data" / "catalogue.json").read_text())}


class Ctx:
    def __init__(self, state):
        self.state = state


PHONE = {"W10": {"name": "Maroon Velvet Kurta", "verdict": "fits", "size": "L"}}


def ctx():
    return Ctx({"store_id": "BLR-07", "fit_verdicts": dict(PHONE), "qr_room": "4"})


def test_never_fills_missing_verdicts_from_another_body():
    r = T.get_fit_verdicts(["W10", "W01"], ctx())
    assert r["verdicts"]["W10"]["size"] == "L"
    assert "error" in r["verdicts"]["W01"]          # not computed from the demo shopper


def test_hold_blocked_for_size_the_engine_did_not_recommend():
    r = T.reserve_trial_room(["W10:M"], ctx())
    assert r["status"] == "failed" and "recommends size L" in r["problems"][0]
    assert T.reserve_trial_room(["W10:L"], ctx())["status"] == "held"


def test_shopper_can_still_choose_another_size_explicitly():
    assert T.reserve_trial_room(["W10:M"], ctx(), shopper_chose_size=True)["status"] == "held"


def test_staff_message_with_wrong_size_is_blocked():
    assert T.notify_staff("Bring Maroon Velvet Kurta size M to room 4", ctx())["status"] == "blocked"
    assert T.notify_staff("Bring Maroon Velvet Kurta size L to room 4 (shopper scanned M)", ctx())["status"] == "sent"


def test_existing_barcodes_unchanged_and_xxl_added():
    assert CAT["W10"]["gtins"]["M"] == "2026010010004"
    assert CAT["M11"]["gtins"]["M"] == "2026022010009"
    assert "XXL" in CAT["W01"]["sizes"] and "36" in CAT["W07"]["sizes"] and "38" in CAT["M06"]["sizes"]


def test_body_just_above_xl_gets_xxl():
    body = {"gender": "women", "height": 163, "chest": 102, "waist": 86, "hip": 109}
    r = recommend(body, CAT["W01"])
    assert r["verdict"] == "fits" and r["size"] == "XXL"
