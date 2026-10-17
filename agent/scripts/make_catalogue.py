"""Generates the demo catalogue (fictional brands) -> data/catalogue.json.

Edit the GARMENTS list to change items, then run:  python scripts/make_catalogue.py
All garment measurements are finished garment measurements in cm.
"""
import json
import random
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
random.seed(7)
STORES = json.loads((DATA / "stores.json").read_text())

TOP_SIZES = ["S", "M", "L", "XL"]
W_JEANS = ["26", "28", "30", "32", "34"]
M_JEANS = ["28", "30", "32", "34", "36"]
# Bigger sizes added later. They are appended after the originals with their own random streams,
# so every existing barcode and stock number stays exactly the same.
EXTRA_TOP = ["XXL"]
EXTRA_W_JEANS = ["36"]
EXTRA_M_JEANS = ["38"]

# style_id, name, brand, gender, category, fit_type, fabric, stretch, price, occasions, colour,
# base measurements for the first size, grading per size, extra tags
GARMENTS = [
    ("W01", "Ivory Chikankari Kurta", "Kaya Threads", "women", "kurta", "regular", "100% cotton", 0, 1899,
     ["wedding", "festive"], "ivory", {"chest": 96, "waist": 82, "hip": 102, "length": 106}, {"chest": 5, "waist": 5, "hip": 5, "length": 1.5}, ["embroidered", "lightweight"]),
    ("W02", "Ivory Chikankari Kurta (Petite)", "Kaya Threads", "women", "kurta", "regular", "100% cotton", 0, 1899,
     ["wedding", "festive"], "ivory", {"chest": 96, "waist": 82, "hip": 102, "length": 96}, {"chest": 5, "waist": 5, "hip": 5, "length": 1.5}, ["embroidered", "petite"]),
    ("W03", "Emerald Silk-Blend Anarkali", "Kaya Threads", "women", "dress", "relaxed", "70% viscose, 30% silk", 0, 3499,
     ["wedding", "festive"], "emerald", {"chest": 94, "waist": 82}, {"chest": 5, "waist": 5}, ["flared", "anarkali"]),
    ("W04", "Rose Gold Sequin Dress", "Lumen Studio", "women", "dress", "fitted", "95% polyester, 5% elastane", 5, 2999,
     ["party", "wedding"], "rose gold", {"chest": 86, "waist": 70, "hip": 94, "length": 92}, {"chest": 5, "waist": 5, "hip": 5, "length": 1}, ["sequin", "evening"]),
    ("W05", "Mustard Block-Print Kurta", "Kaya Threads", "women", "kurta", "slim", "100% cotton", 0, 1299,
     ["casual", "festive"], "mustard", {"chest": 90, "waist": 74, "hip": 98, "length": 100}, {"chest": 5, "waist": 5, "hip": 5, "length": 1.5}, ["block print"]),
    ("W06", "Navy Linen Shirt Dress", "Urban Loom", "women", "dress", "relaxed", "100% linen", 0, 2199,
     ["office", "casual"], "navy", {"chest": 98, "waist": 82, "hip": 104, "length": 92}, {"chest": 5, "waist": 5, "hip": 5, "length": 1}, ["linen", "breathable"]),
    ("W07", "High-Rise Stretch Jeans", "Denim Republic", "women", "jeans", "slim", "92% cotton, 6% polyester, 2% elastane", 8, 1799,
     ["casual"], "mid blue", {"waist": 64, "hip": 86, "inseam": 74}, {"waist": 5, "hip": 5, "inseam": 0}, ["stretch", "high rise"]),
    ("W08", "Wide-Leg Pleated Trousers", "Urban Loom", "women", "trousers", "regular", "65% polyester, 35% viscose", 0, 1599,
     ["office", "wedding"], "black", {"waist": 66, "hip": 96, "inseam": 76}, {"waist": 5, "hip": 5, "inseam": 0}, ["pleated", "wide leg"]),
    ("W09", "Classic White Shirt (Women)", "Urban Loom", "women", "shirt", "regular", "100% cotton poplin", 0, 1199,
     ["office", "casual"], "white", {"chest": 96, "waist": 84, "length": 66}, {"chest": 5, "waist": 5, "length": 1}, ["poplin"]),
    ("W10", "Maroon Velvet Kurta", "Raag Couture", "women", "kurta", "regular", "100% polyester velvet", 0, 2499,
     ["wedding", "festive"], "maroon", {"chest": 92, "waist": 80, "hip": 98, "length": 100}, {"chest": 5, "waist": 5, "hip": 5, "length": 1.5}, ["velvet", "runs small"]),
    ("M01", "Off-White Linen Kurta", "Raag Couture", "men", "kurta", "regular", "100% linen", 0, 2199,
     ["wedding", "festive"], "off-white", {"chest": 102, "waist": 94, "hip": 104, "length": 104}, {"chest": 5, "waist": 5, "hip": 5, "length": 1.5}, ["linen"]),
    ("M02", "Midnight Blue Nehru Blazer", "Raag Couture", "men", "blazer", "regular", "80% polyester, 20% viscose", 0, 3999,
     ["wedding", "party"], "midnight blue", {"chest": 100, "waist": 90, "length": 72}, {"chest": 5, "waist": 5, "length": 1.5}, ["bandhgala"]),
    ("M03", "Sage Oxford Shirt", "Urban Loom", "men", "shirt", "slim", "100% cotton oxford", 0, 1499,
     ["office", "casual"], "sage", {"chest": 100, "waist": 92, "length": 72}, {"chest": 5, "waist": 5, "length": 1.5}, ["oxford"]),
    ("M04", "Classic White Shirt", "Urban Loom", "men", "shirt", "regular", "100% cotton poplin", 0, 1299,
     ["office", "wedding"], "white", {"chest": 104, "waist": 98, "length": 74}, {"chest": 5, "waist": 5, "length": 1.5}, ["poplin"]),
    ("M05", "Slim Stretch Chinos", "Denim Republic", "men", "trousers", "regular", "97% cotton, 3% elastane", 3, 1699,
     ["office", "casual"], "khaki", {"waist": 72, "hip": 94, "inseam": 80}, {"waist": 5, "hip": 5, "inseam": 0}, ["stretch", "chinos"]),
    ("M06", "Indigo Straight Jeans", "Denim Republic", "men", "jeans", "regular", "100% cotton denim", 0, 1999,
     ["casual"], "indigo", {"waist": 74, "hip": 96, "inseam": 81}, {"waist": 5, "hip": 5, "inseam": 0}, ["rigid denim"]),
    ("M07", "Charcoal Oversized Tee", "Lumen Studio", "unisex", "tshirt", "oversized", "100% cotton jersey", 2, 799,
     ["casual"], "charcoal", {"chest": 108, "length": 70}, {"chest": 6, "length": 1.5}, ["oversized"]),
    ("M08", "Black Crew Tee", "Lumen Studio", "unisex", "tshirt", "regular", "95% cotton, 5% elastane", 6, 599,
     ["casual"], "black", {"chest": 94, "length": 68}, {"chest": 5, "length": 1.5}, ["basic"]),
    ("M09", "Saffron Silk Kurta", "Raag Couture", "men", "kurta", "slim", "silk blend", 0, 2799,
     ["wedding", "festive"], "saffron", {"chest": 98, "waist": 88, "hip": 100, "length": 104}, {"chest": 5, "waist": 5, "hip": 5, "length": 1.5}, ["silk"]),
    ("M10", "Beige Pleated Trousers", "Urban Loom", "men", "trousers", "regular", "70% polyester, 30% viscose", 0, 1799,
     ["office", "wedding"], "beige", {"waist": 74, "hip": 92, "inseam": 80}, {"waist": 5, "hip": 5, "inseam": 0}, ["pleated"]),
    # appended last so existing barcodes stay the same; demo for the sitting-posture check
    ("W11", "High-Waist Rigid Mom Jeans", "Denim Republic", "women", "jeans", "slim", "100% rigid cotton denim", 0, 2299,
     ["casual"], "light blue", {"waist": 69, "hip": 94, "inseam": 72}, {"waist": 5, "hip": 5, "inseam": 0}, ["rigid", "mom fit", "no stretch"]),
    # demo for the sitting check on shirts: M fits standing but pulls at the buttons and rides up when seated
    ("M11", "Tailored Extra-Slim Shirt", "Urban Loom", "men", "shirt", "slim", "100% cotton poplin", 0, 1899,
     ["office", "party"], "sky blue", {"chest": 101, "waist": 86.5, "length": 74}, {"chest": 5, "waist": 5, "length": 1.5}, ["tailored", "extra slim"]),
]

# Fixed stock for the demo story; everything else is random.
FIXED_STOCK = {
    ("W01", "M", "BLR-07"): 3, ("W02", "M", "BLR-07"): 2,
    ("W04", "M", "BLR-07"): 0, ("W04", "M", "BLR-12"): 2,
    ("W03", "M", "BLR-07"): 1, ("W03", "L", "BLR-07"): 1,
    ("M11", "M", "BLR-07"): 3, ("M11", "L", "BLR-07"): 2,
    ("W11", "28", "BLR-07"): 3, ("W11", "30", "BLR-07"): 2,
    ("W01", "L", "BLR-07"): 2, ("W02", "L", "BLR-07"): 2, ("W10", "L", "BLR-07"): 2,
}


def sizes_for(gender, category):
    if category in ("jeans", "trousers"):
        return W_JEANS if gender == "women" else M_JEANS
    return TOP_SIZES


def extra_sizes_for(gender, category):
    if category in ("jeans", "trousers"):
        return EXTRA_W_JEANS if gender == "women" else EXTRA_M_JEANS
    return EXTRA_TOP


def ean13(first12: str) -> str:
    """Valid EAN-13 from 12 digits. Prefix 20-29 is reserved for in-store use, so these never clash with real products."""
    total = sum(int(d) * (3 if i % 2 else 1) for i, d in enumerate(first12))
    return first12 + str((10 - total % 10) % 10)


def build():
    out = []
    for idx, (sid, name, brand, gender, cat, fit, fabric, stretch, price, occ, colour, base, grade, tags) in enumerate(GARMENTS, start=1):
        labels = sizes_for(gender, cat)
        extra = extra_sizes_for(gender, cat)
        all_labels = labels + extra
        gtins = {lab: ean13(f"2026{idx:03d}{j:02d}000") for j, lab in enumerate(all_labels)}
        sizes = {lab: {k: round(v + grade.get(k, 0) * i, 1) for k, v in base.items()} for i, lab in enumerate(all_labels)}
        stock = {}
        for store in ("BLR-07", "BLR-12"):          # original demo stores: keep their stock exactly as before
            stock[store] = {lab: FIXED_STOCK.get((sid, lab, store), random.choice([0, 1, 2, 3, 4, 5])) for lab in labels}
            for lab in extra:
                stock[store][lab] = FIXED_STOCK.get((sid, lab, store), random.Random(f"{sid}-{store}-{lab}").choice([0, 1, 2, 3]))
        for store in STORES:                         # every other metro store gets its own repeatable stock
            if store not in stock:
                rng = random.Random(f"{sid}-{store}")
                stock[store] = {lab: FIXED_STOCK.get((sid, lab, store), rng.choice([0, 1, 2, 3, 4, 5])) for lab in labels}
                for lab in extra:
                    stock[store][lab] = FIXED_STOCK.get((sid, lab, store), rng.choice([0, 1, 2, 3]))
        out.append({
            "style_id": sid, "name": name, "brand": brand, "gender": gender, "category": cat,
            "fit_type": fit, "fabric": fabric, "stretch_pct": stretch, "price_inr": price,
            "occasions": occ, "colour": colour, "tags": tags, "sizes": sizes, "gtins": gtins, "stock": stock,
            "source": "demo", "status": "approved",
        })
    return out


if __name__ == "__main__":
    DATA.mkdir(exist_ok=True)
    cat = build()
    (DATA / "catalogue.json").write_text(json.dumps(cat, indent=1, ensure_ascii=False))
    print(f"Wrote {len(cat)} garments to {DATA / 'catalogue.json'}")
