// Snug fit engine, ON THE PHONE. Same rules as snug_core/fit_engine.py (keep them in sync).
// Body measurements never leave the device: only verdicts are shared with the AI agent.
(function () {
  const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL", "26", "28", "30", "32", "34", "36", "38", "40"];
  const EASE = {
    "kurta|regular": { chest: 10, waist: 12, hip: 12 }, "kurta|slim": { chest: 6, waist: 6, hip: 8 },
    "shirt|slim": { chest: 8, waist: 8 }, "shirt|regular": { chest: 12, waist: 14 },
    "tshirt|regular": { chest: 8 }, "tshirt|oversized": { chest: 18 },
    "dress|fitted": { chest: 5, waist: 4, hip: 5 }, "dress|relaxed": { chest: 10, waist: 12, hip: 12 },
    "jeans|slim": { waist: 1, hip: 3 }, "jeans|regular": { waist: 2, hip: 6 },
    "trousers|regular": { waist: 2.5, hip: 6 }, "blazer|regular": { chest: 10, waist: 10 },
  };
  const WEIGHTS = {
    kurta: { chest: 0.35, waist: 0.2, hip: 0.25, length: 0.2 }, shirt: { chest: 0.5, waist: 0.3, length: 0.2 },
    tshirt: { chest: 0.7, length: 0.3 }, dress: { chest: 0.3, waist: 0.3, hip: 0.25, length: 0.15 },
    jeans: { waist: 0.5, hip: 0.3, inseam: 0.2 }, trousers: { waist: 0.5, hip: 0.3, inseam: 0.2 },
    blazer: { chest: 0.55, waist: 0.25, length: 0.2 },
  };
  const LENGTH_RATIO = { kurta: 0.61, shirt: 0.43, tshirt: 0.40, dress: 0.56, blazer: 0.43 };
  const TIGHT_TOL = -1.5, LENGTH_TOL = 5.0, COMFORT = 0.45;
  const LOOSE_TOL = { default: 6.0, oversized: 10.0 };
  const PREF = { snug: -2, regular: 0, relaxed: 3 };
  const r1 = (x) => Math.round(x * 10) / 10;
  // Sitting-posture check for bottoms (same rules as fit_engine.py).
  const SEATED_WEIGHTS = { jeans: { waist: 0.4, hip: 0.3 }, trousers: { waist: 0.4, hip: 0.3 },
    shirt: { waist: 0.3, length: 0.15 }, tshirt: { length: 0.15 }, blazer: { waist: 0.3 },
    kurta: { waist: 0.2, hip: 0.2 }, dress: { waist: 0.3, hip: 0.2 } };
  const SEATED_DEFAULT_GAIN = { waist: 3.0, hip: 4.0 };
  const SEATED_EASE = { jeans: { waist: 0.0, hip: 1.0 }, trousers: { waist: 0.0, hip: 1.0 },
    "shirt|slim": { waist: 6.0 }, "shirt|regular": { waist: 8.0 }, blazer: { waist: 6.0 },
    "kurta|slim": { waist: 4.0, hip: 3.0 }, "kurta|regular": { waist: 6.0, hip: 4.0 },
    "dress|fitted": { waist: 1.0, hip: 1.0 }, "dress|relaxed": { waist: 6.0, hip: 4.0 } };
  const SEATED_LENGTH_RISE = 3.0, SEATED_SHORT_TOL = -6.0, SEATED_TIGHT_TOL = -1.0, SEATED_COMFORT = 0.6;
  const seatedEase = (cat, fit, pom) => ((SEATED_EASE[`${cat}|${fit}`] || SEATED_EASE[cat] || {})[pom] ?? 0);
  function seatedBody(p, pom) {
    const v = p["seated_" + pom]; if (v) return [v, false];
    return p[pom] ? [p[pom] + SEATED_DEFAULT_GAIN[pom], true] : [null, true];
  }

  function targetEase(cat, fit, pom, pref) {
    const base = EASE[`${cat}|${fit}`] || EASE[`${cat}|regular`] || {};
    return (pom in base ? base[pom] : 4.0) + (PREF[pref] || 0);
  }
  function lengthTarget(cat, p, pom) {
    if (pom === "inseam") return p.inseam ?? null;
    if (pom === "length" && p.height && cat in LENGTH_RATIO) return r1(p.height * LENGTH_RATIO[cat]);
    return null;
  }

  function evaluateSize(p, g, size, pref = "regular") {
    const cat = g.category, fit = g.fit_type || "regular", stretch = g.stretch_pct || 0;
    const spec = g.sizes[size], weights = WEIGHTS[cat] || {};
    const looseTol = fit === "oversized" ? LOOSE_TOL.oversized : LOOSE_TOL.default;
    const points = []; let score = 0;
    for (const [pom, w] of Object.entries(weights)) {
      if (!(pom in spec)) continue;
      const gv = spec[pom]; let delta, status;
      if (pom === "length" || pom === "inseam") {
        const t = lengthTarget(cat, p, pom); if (t == null) continue;
        delta = r1(gv - t);
        status = delta > LENGTH_TOL ? "long" : delta < -LENGTH_TOL ? "short" : "ok";
        score += w * Math.max(0, Math.abs(delta) - LENGTH_TOL / 2) * 0.6;
      } else {
        const body = p[pom]; if (body == null) continue;
        const target = body + targetEase(cat, fit, pom, pref);
        delta = gv - target;
        if (delta < 0 && stretch) delta = gv * (1 + COMFORT * stretch / 100) - target;
        delta = r1(delta);
        status = delta < TIGHT_TOL ? "tight" : delta > looseTol ? "loose" : "ok";
        if (delta < 0) score += w * 2 * Math.abs(delta);
        else if (delta > looseTol / 2) score += w * (delta - looseTol / 2);
      }
      points.push({ pom, delta_cm: delta, status });
    }
    const seated_points = [];
    for (const [pom, w] of Object.entries(SEATED_WEIGHTS[cat] || {})) {
      if (!(pom in spec)) continue;
      if (pom === "length") {
        const t = lengthTarget(cat, p, pom); if (t == null) continue;
        const d = r1(spec[pom] - (t + SEATED_LENGTH_RISE));
        if (d < SEATED_SHORT_TOL) score += w * 0.6 * (SEATED_SHORT_TOL - d);
        seated_points.push({ pom, delta_cm: d, status: d < SEATED_SHORT_TOL ? "short_sitting" : "ok", estimated: false });
        continue;
      }
      const [bodyS, estimated] = seatedBody(p, pom);
      if (bodyS == null) continue;
      const delta = r1(spec[pom] * (1 + SEATED_COMFORT * stretch / 100) - (bodyS + seatedEase(cat, fit, pom)));
      const status = delta < SEATED_TIGHT_TOL ? "tight_sitting" : "ok";
      if (delta < 0) score += w * 3 * Math.abs(delta);
      seated_points.push({ pom, delta_cm: delta, status, estimated });
    }
    return { size, score: Math.round(score * 100) / 100, points, seated_points };
  }

  const nice = (pt) => {
    const amt = `about ${(Math.abs(pt.delta_cm) / 2.54).toFixed(1)} in`;
    if (pt.status === "tight_sitting") return `${amt} tight at the ${pt.pom} when you sit`;
    if (pt.status === "short_sitting") return `riding up ${amt} when you sit`;
    return (pt.pom === "length" || pt.pom === "inseam") ? `${amt} too ${pt.status}${pt.pom === "inseam" ? " in the leg" : ""}` : `${amt} ${pt.status} at the ${pt.pom === "chest" ? "chest" : pt.pom}`;
  };
  const note = (pt) => pt.status === "tight_sitting" ? `${pt.pom} about ${(Math.abs(pt.delta_cm) / 2.54).toFixed(1)} in tight when sitting`
    : pt.status === "short_sitting" ? `rides up about ${(Math.abs(pt.delta_cm) / 2.54).toFixed(1)} in when sitting`
    : `${pt.pom} about ${(Math.abs(pt.delta_cm) / 2.54).toFixed(1)} in ${pt.status}`;
  const top2 = (arr) => [...arr].sort((a, b) => Math.abs(b.delta_cm) - Math.abs(a.delta_cm)).slice(0, 2);   // keep headlines short
  const issues = (r) => [...r.points, ...(r.seated_points || [])].filter((x) => x.status !== "ok");
  const sortSizes = (sizes) => sizes.sort((a, b) => (SIZE_ORDER.indexOf(a) + 1 || 99) - (SIZE_ORDER.indexOf(b) + 1 || 99));

  function recommend(p, g, pref = "regular") {
    const results = sortSizes(Object.keys(g.sizes)).map((s) => evaluateSize(p, g, s, pref))
      .sort((a, b) => a.score - b.score);
    const best = results[0], runner = results[1];
    const tight = best.points.some((x) => x.status === "tight");
    const sp = best.seated_points || [];
    const verdict = tight ? "no_good_fit" : "fits";
    const confidence = tight ? "high" : (!runner || runner.score - best.score > 1.5 ? "high" : "medium");
    const other = {};
    for (const r of results.slice(1, 3)) { const n = issues(r).map(note); if (n.length) other[r.size] = n; }
    return { verdict, size: best.size, confidence, notes: issues(best).map(note),
             sitting: !sp.length ? null : sp.some((x) => x.status !== "ok") ? "tight" : "comfortable",
             sitting_estimated: sp.some((x) => x.estimated) || null,
             between_sizes: confidence === "medium" && runner ? runner.size : null, other_sizes: other };
  }

  // Plain words for sitting problems, e.g. "will pull at the buttons (waist about 0.6 in) and ride up about 1.3 in".
  function sitPhrase(pts, cat) {
    const tops = ["shirt", "blazer", "kurta", "dress", "tshirt"].includes(cat);
    const tight = pts.filter((x) => x.status === "tight_sitting"), short = pts.find((x) => x.status === "short_sitting");
    const parts = [];
    if (tight.length) parts.push(`${tops ? "will pull at the buttons" : "will dig in"} (${tight.map((x) => `${x.pom} about ${(Math.abs(x.delta_cm) / 2.54).toFixed(1)} in`).join(", ")})`);
    if (short) parts.push(`will ride up about ${(Math.abs(short.delta_cm) / 2.54).toFixed(1)} in`);
    return parts.join(" and ");
  }

  // Verdict for the exact size on the scanned tag, plus the recommendation, in plain language.
  function verdictForScan(p, g, scannedSize, pref = "regular") {
    const rec = recommend(p, g, pref);
    const scanned = evaluateSize(p, g, scannedSize, pref);
    const issuesS = issues(scanned);
    let headline;
    if (rec.verdict === "no_good_fit") {
      const order = sortSizes(Object.keys(g.sizes)), recIss = issues(evaluateSize(p, g, rec.size, pref));
      const allTight = recIss.length && recIss.every((x) => x.status.startsWith("tight"));
      headline = rec.size === order[order.length - 1] && allTight
        ? `Even the largest size here (${rec.size}) will be ${top2(recIss).map(nice).join(" and ")}. This style runs small for you.`
        : rec.size === order[0] && recIss.length && recIss.every((x) => x.status.startsWith("loose"))
        ? `Even the smallest size here (${rec.size}) will be ${recIss.map(nice).join(" and ")}.`
        : `This style may not fit well in any size. Closest is ${rec.size}.`;
    }
    else if (rec.size === scannedSize && !issuesS.length) headline = `Size ${scannedSize} should fit you well.`;
    else if (rec.size === scannedSize) headline = `Size ${scannedSize} is your best size here, though it runs ${issuesS.map(nice).join(" and ")}.`;
    else if (issuesS.length && issuesS.every((x) => x.status.endsWith("_sitting")))
      headline = `Size ${scannedSize} fits standing, but when you sit it ${sitPhrase(issuesS, g.category)}. Grab size ${rec.size} instead.`;
    else headline = `Size ${scannedSize} will be ${issuesS.length ? top2(issuesS).map(nice).join(" and ") : "less comfortable"}. Grab size ${rec.size} instead.`;
    return { headline, scanned_size: scannedSize, scanned_points: scanned.points, scanned_seated: scanned.seated_points, recommendation: rec,
             all_sizes: sortSizes(Object.keys(g.sizes)).map((s) => evaluateSize(p, g, s, pref)) };
  }

  // Verdicts for many garments: this map (no body numbers) is what the agent is allowed to see.
  function verdictMap(p, garments, pref = "regular") {
    const out = {};
    for (const g of garments) { const r = recommend(p, g, pref); out[g.style_id] = { name: g.name, ...r }; }
    return out;
  }

  const api = { evaluateSize, recommend, verdictForScan, verdictMap, sortSizes, sitPhrase };
  if (typeof module !== "undefined") module.exports = api; else window.SnugFit = api;
})();
