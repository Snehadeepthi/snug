"""Tools for the Snug Fit Concierge. ADK turns these typed, documented functions into Gemini tools.

Session state used (set by the web app when it creates a session):
  profile   -> body measurements in cm (demo profile; production keeps this on the phone)
  store_id  -> the store the shopper is in, e.g. "BLR-07"
"""
from __future__ import annotations

import re
from typing import Optional

from google.adk.tools import ToolContext

from snug_core.db import PROFILES, STORES, get_db
from snug_core.fit_engine import recommend

DEFAULT_STORE = "BLR-07"


def _store(tool_context: ToolContext) -> str:
    return tool_context.state.get("store_id") or DEFAULT_STORE


def _profile(tool_context: ToolContext) -> tuple[dict, str]:
    p = tool_context.state.get("profile")
    if p:
        return p, "session"
    return PROFILES["ananya"], "demo_default"


def _summary(g: dict) -> dict:
    return {k: g.get(k) for k in ("style_id", "name", "brand", "gender", "category", "fit_type",
                                  "price_inr", "colour", "fabric", "occasions", "tags")}


def search_catalogue(query: str, tool_context: ToolContext, category: str = "", occasion: str = "",
                     max_price_inr: int = 0, gender: str = "") -> dict:
    """Search the store catalogue for garments.

    Args:
      query: free-text description, e.g. "festive kurta" or "white office shirt".
      category: optional exact category: kurta, shirt, tshirt, dress, jeans, trousers, blazer.
      occasion: optional occasion: wedding, festive, party, office, casual.
      max_price_inr: optional maximum price in rupees (0 = no limit).
      gender: optional women, men or unisex. Defaults to the shopper's profile.

    Returns up to 12 matching garments (no sizes; use get_fit_verdicts for sizing).
    """
    profile, _ = _profile(tool_context)
    gender = (gender or tool_context.state.get("gender") or profile.get("gender") or "").lower()
    words = [w for w in re.findall(r"[a-z]+", query.lower()) if len(w) > 2]
    results = []
    for g in get_db().list_garments():
        if category and g["category"] != category.lower():
            continue
        if occasion and occasion.lower() not in g["occasions"]:
            continue
        if max_price_inr and g["price_inr"] > max_price_inr:
            continue
        if gender and g["gender"] not in (gender, "unisex"):
            continue
        text = " ".join([g["name"], g["category"], g["fit_type"], g["colour"], g["fabric"],
                         " ".join(g["occasions"]), " ".join(g["tags"])]).lower()
        score = sum(1 for w in words if w in text)
        if words and score == 0 and not (category or occasion):
            continue
        results.append((score, g))
    results.sort(key=lambda x: (-x[0], x[1]["price_inr"]))
    items = [_summary(g) for _, g in results[:12]]
    return {"count": len(items), "results": items}


def get_garment_details(style_id: str) -> dict:
    """Get full details of one garment, including its variants (e.g. a Petite version) and available sizes."""
    g = get_db().get_garment(style_id)
    if not g:
        return {"error": f"Unknown style_id {style_id}"}
    base = g["name"].split(" (")[0]
    variants = [_summary(o) for o in get_db().list_garments()
                if o["style_id"] != style_id and o["name"].split(" (")[0] == base]
    return {**_summary(g), "sizes": list(g["sizes"].keys()), "variants": variants}


def get_fit_verdicts(style_ids: list[str], tool_context: ToolContext) -> dict:
    """Get the shopper's fit verdict for each garment. ALWAYS use this for sizing; never guess sizes.

    Verdicts are computed ON THE SHOPPER'S PHONE by the Snug fit engine from their private body scan;
    only the verdicts are shared with you, never body measurements.

    Args:
      style_ids: garments to check, e.g. ["W01", "W03"].

    Returns, per style: verdict ("fits" or "no_good_fit"), best size, confidence and plain-language notes.
    """
    phone = tool_context.state.get("fit_verdicts") or {}
    out, missing = {}, []
    for sid in style_ids:
        if sid in phone:
            out[sid] = phone[sid]
        else:
            missing.append(sid)
    source = "phone"
    if missing:
        # Fallback for demos without a phone profile (e.g. ADK dev UI): compute from a demo profile.
        profile = tool_context.state.get("profile") or PROFILES["ananya"]
        source = "phone" if not out else "phone+demo_fallback"
        if not phone:
            source = "demo_profile"
        for sid in missing:
            g = get_db().get_garment(sid)
            out[sid] = {"name": g["name"], **recommend(profile, g)} if g else {"error": "unknown style"}
    res = {"computed_on": source, "verdicts": out}
    if tool_context.state.get("shopping_for"):
        res["for_person"] = tool_context.state["shopping_for"]   # which saved passport on the phone these are for
    return res


def get_scanned_item(tool_context: ToolContext) -> dict:
    """What the shopper just scanned in the store: garment, size on the tag, and the phone's fit verdict."""
    scanned = tool_context.state.get("scanned")
    if not scanned:
        return {"scanned": None, "note": "The shopper has not scanned a tag yet."}
    return scanned


def check_stock(style_id: str, size: str, tool_context: ToolContext) -> dict:
    """Check live stock for a garment size in the shopper's store, other sizes here, and nearby stores."""
    g = get_db().get_garment(style_id)
    if not g:
        return {"error": f"Unknown style_id {style_id}"}
    store = _store(tool_context)
    stock = g.get("stock", {})
    here = stock.get(store, {})
    nearby = [{"store_id": s, "store_name": STORES[s]["name"], "qty": stock.get(s, {}).get(size, 0)}
              for s in STORES.get(store, {}).get("nearby", []) if stock.get(s, {}).get(size, 0) > 0]
    return {"style_id": style_id, "name": g["name"], "size": size, "store_id": store,
            "in_store_qty": here.get(size, 0),
            "other_sizes_in_store": {k: v for k, v in here.items() if v > 0 and k != size},
            "nearby_stores_with_size": nearby}


def reserve_trial_room(items: list[str], tool_context: ToolContext) -> dict:
    """Hold items in a trial room for the shopper. Only call AFTER the shopper confirms.

    Args:
      items: list of "STYLE_ID:SIZE" strings, e.g. ["W01:M", "W03:M"]. Each must be in stock.
    """
    db, store = get_db(), _store(tool_context)
    held, problems = [], []
    for it in items:
        sid, _, size = it.partition(":")
        g = db.get_garment(sid.strip())
        qty = (g or {}).get("stock", {}).get(store, {}).get(size.strip(), 0)
        if not g or qty <= 0:
            problems.append(f"{it} is not in stock here")
        else:
            held.append({"style_id": g["style_id"], "name": g["name"], "size": size.strip()})
    if not held:
        return {"status": "failed", "problems": problems}

    room = tool_context.state.get("hold_room") or tool_context.state.get("qr_room")   # room from the trial-room QR
    if room:
        tool_context.state["hold_room"] = room
    else:
        busy = {h.get("room") for h in db.list_holds(store)}
        free = [r for r in STORES[store]["trial_rooms"] if r not in busy]
        room = free[0] if free else STORES[store]["trial_rooms"][-1]
        tool_context.state["hold_room"] = room
    hold_id = db.add_hold(store, {"room": room, "items": held})
    return {"status": "held", "store_id": store, "room": room, "hold_id": hold_id,
            "items": held, "problems": problems}


def notify_staff(message: str, tool_context: ToolContext, room: Optional[str] = None) -> dict:
    """Send a task to store staff, e.g. "Bring Ivory Chikankari Kurta (Petite) size M to room 4".
    Only call after the shopper agrees. Uses the shopper's held trial room if room is not given."""
    store = _store(tool_context)
    room = room or tool_context.state.get("hold_room") or tool_context.state.get("qr_room") or "floor"
    task_id = get_db().add_task(store, {"room": room, "message": message})
    return {"status": "sent", "task_id": task_id, "store_id": store, "room": room}


def record_feedback(style_id: str, recommended_size: str, kept_size: str, fit_rating: str,
                    tool_context: ToolContext) -> dict:
    """Record which size the shopper kept and how it fit ("too tight", "perfect", "too loose", "too long",
    "too short"). Anonymous: stores no user id and no body measurements."""
    get_db().add_feedback({"style_id": style_id, "recommended_size": recommended_size,
                           "kept_size": kept_size, "fit_rating": fit_rating, "store_id": _store(tool_context)})
    return {"status": "recorded"}


PAIRS = {"kurta": ["trousers"], "shirt": ["trousers", "jeans", "blazer"], "tshirt": ["jeans", "trousers"],
         "blazer": ["shirt", "trousers"], "jeans": ["shirt", "tshirt"], "trousers": ["kurta", "shirt"], "dress": []}


def suggest_pairings(style_id: str, tool_context: ToolContext) -> dict:
    """"Complete the look": garments that pair with this one (same section, overlapping occasion).
    Then use get_fit_verdicts and check_stock on them before recommending."""
    g = get_db().get_garment(style_id)
    if not g:
        return {"error": f"Unknown style_id {style_id}"}
    cats = PAIRS.get(g["category"], [])
    gender = tool_context.state.get("gender") or g["gender"]
    out = [_summary(o) for o in get_db().list_garments()
           if o["category"] in cats and o["gender"] in (gender, "unisex")
           and (not g["occasions"] or set(o["occasions"]) & set(g["occasions"]))]
    return {"for": g["name"], "pairs_well_with": out[:6], "note": "Dresses are complete outfits." if g["category"] == "dress" else ""}
