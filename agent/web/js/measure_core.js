// Snug body-measurement geometry (runs on the phone).
// Input: MediaPipe pose landmarks + body segmentation mask for a FRONT photo (A-pose) and optionally a SIDE photo,
// plus the user's height. Output: body measurements in cm. Pure functions, no network.
(function () {
  const L = { lShoulder: 11, rShoulder: 12, lHip: 23, rHip: 24, lAnkle: 27, rAnkle: 28 };
  const DEPTH_RATIO = { chest: 0.72, waist: 0.76, hip: 0.82 };   // used only if no side photo
  const RANGES = { chest: [65, 160], waist: [50, 150], hip: [70, 165], inseam: [55, 100], shoulder: [30, 60] };

  const isBody = (m, x, y) => m.data[y * m.width + x] > 0.5;

  function rowHasBody(m, y) { for (let x = 0; x < m.width; x++) if (isBody(m, x, y)) return true; return false; }
  function topBottom(m) {
    let top = 0, bottom = m.height - 1;
    while (top < m.height && !rowHasBody(m, top)) top++;
    while (bottom > top && !rowHasBody(m, bottom)) bottom--;
    return [top, bottom];
  }
  // Width (px) of the continuous body run on row y that contains (or is nearest to) column cx.
  function runAt(m, y, cx) {
    y = Math.max(0, Math.min(m.height - 1, Math.round(y))); cx = Math.round(cx);
    if (!isBody(m, cx, y)) {
      const lim = Math.round(m.width * 0.05); let found = -1;
      for (let d = 1; d <= lim && found < 0; d++) { if (cx - d >= 0 && isBody(m, cx - d, y)) found = cx - d; else if (cx + d < m.width && isBody(m, cx + d, y)) found = cx + d; }
      if (found < 0) return 0; cx = found;
    }
    let l = cx, r = cx;
    while (l > 0 && isBody(m, l - 1, y)) l--;
    while (r < m.width - 1 && isBody(m, r + 1, y)) r++;
    return r - l + 1;
  }
  const ramanujan = (w, d) => { const a = w / 2, b = d / 2; return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))); };
  const avg = (a, b) => (a + b) / 2;

  function analyseFront(m, lm, heightCm) {
    const [top, bottom] = topBottom(m);
    const pxH = bottom - top; if (pxH < m.height * 0.3) throw new Error("Body not fully visible: stand back so head and feet are in the photo.");
    const s = heightCm / pxH;                                            // cm per pixel
    const P = (i) => ({ x: lm[i].x * m.width, y: lm[i].y * m.height, v: lm[i].visibility ?? 1 });
    const shY = avg(P(L.lShoulder).y, P(L.rShoulder).y), hipY = avg(P(L.lHip).y, P(L.rHip).y);
    const cx = avg(P(L.lHip).x, P(L.rHip).x), t = hipY - shY;
    const shoulderPx = Math.abs(P(L.lShoulder).x - P(L.rShoulder).x) * 1.15;
    const ankleY = avg(P(L.lAnkle).y, P(L.rAnkle).y);

    const rows = (a, b) => { const out = []; for (let y = Math.round(a); y <= Math.round(b); y++) out.push(y); return out; };
    const chestRows = rows(shY + 0.22 * t, shY + 0.36 * t);
    const chestW = Math.min(Math.max(...chestRows.map((y) => runAt(m, y, cx))), shoulderPx * 1.05);
    let waistY = shY + 0.65 * t, waistW = Infinity;
    for (const y of rows(shY + 0.5 * t, shY + 0.9 * t)) { const w = runAt(m, y, cx); if (w > 0 && w < waistW) { waistW = w; waistY = y; } }
    let crotchY = ankleY;
    for (let y = Math.round(hipY); y < ankleY; y++) if (!isBody(m, Math.round(cx), y)) { crotchY = y; break; }
    let hipW = 0, hipYbest = hipY;
    for (const y of rows(hipY - 0.05 * t, Math.min(hipY + 0.25 * t, crotchY - 1))) { const w = runAt(m, y, cx); if (w > hipW) { hipW = w; hipYbest = y; } }
    const chestY = chestRows[Math.floor(chestRows.length / 2)];
    const vis = Math.min(...[11, 12, 23, 24, 27, 28].map((i) => P(i).v));
    return {
      s, top, pxH,
      levels: { chest: (chestY - top) / pxH, waist: (waistY - top) / pxH, hip: (hipYbest - top) / pxH },
      widths: { chest: chestW * s, waist: waistW * s, hip: hipW * s },
      shoulder: shoulderPx * s,
      inseam: (ankleY - crotchY) * s + 2,
      visibility: vis,
      torsoCm: t * s, waistFrac: (waistY - shY) / t,
    };
  }

  function analyseSide(m, lm, heightCm, levels) {
    const [top, bottom] = topBottom(m); const pxH = bottom - top; const s = heightCm / pxH;
    const cx = avg(lm[L.lHip].x, lm[L.rHip].x) * m.width;
    const depths = {};
    for (const k of ["chest", "waist", "hip"]) depths[k] = runAt(m, top + levels[k] * pxH, cx) * s;
    return depths;
  }

  // Sitting photo (side view, sitting upright on a chair, arms crossed on the chest).
  // Height can't be the ruler when seated, so the torso length from the standing photo is used instead.
  function analyseSeated(m, lm, torsoCm, waistFrac) {
    const P = (i) => ({ x: lm[i].x * m.width, y: lm[i].y * m.height });
    const sh = { x: avg(P(11).x, P(12).x), y: avg(P(11).y, P(12).y) }, hp = { x: avg(P(23).x, P(24).x), y: avg(P(23).y, P(24).y) };
    const tPx = Math.hypot(hp.x - sh.x, hp.y - sh.y);
    if (tPx < m.height * 0.12) throw new Error("Sitting photo: upper body too small or not found.");
    const s = torsoCm / tPx;
    const y = sh.y + waistFrac * (hp.y - sh.y), x = sh.x + waistFrac * (hp.x - sh.x);
    return { waistDepth: runAt(m, y, x) * s };
  }

  function computeMeasurements({ heightCm, front, side, seated }) {
    const warnings = [];
    const f = analyseFront(front.mask, front.landmarks, heightCm);
    if (f.visibility < 0.5) warnings.push("Some body points were hard to see. Better light and fitted clothes improve accuracy.");
    let depths, method = "two_photos";
    if (side) {
      try { depths = analyseSide(side.mask, side.landmarks, heightCm, f.levels); }
      catch (e) { warnings.push("Side photo could not be used; depth was estimated."); }
    }
    if (!depths) { method = "front_only"; depths = {}; for (const k in DEPTH_RATIO) depths[k] = f.widths[k] * DEPTH_RATIO[k]; }
    const out = { height: heightCm, method };
    for (const k of ["chest", "waist", "hip"]) {
      let d = depths[k];
      if (!(d > 0) || d > f.widths[k] * 1.3 || d < f.widths[k] * 0.45) { d = f.widths[k] * DEPTH_RATIO[k]; warnings.push(`${k} depth looked unusual; estimated instead.`); }
      out[k] = Math.round(ramanujan(f.widths[k], d) * 2) / 2;
    }
    out.inseam = Math.round(f.inseam * 2) / 2;
    // Sitting posture: the waist widens slightly and pushes forward when you sit.
    out.seated_method = "estimated";
    if (seated) {
      try {
        const sd = analyseSeated(seated.mask, seated.landmarks, f.torsoCm, f.waistFrac);
        const w = f.widths.waist * 1.03, standingDepth = depths.waist || f.widths.waist * DEPTH_RATIO.waist;
        if (sd.waistDepth > standingDepth * 0.9 && sd.waistDepth < w * 1.4) {
          const sw = Math.round(ramanujan(w, sd.waistDepth) * 2) / 2;
          out.seated_waist = Math.max(sw, out.waist + 0.5);
          out.seated_hip = Math.round(out.hip * 1.04 * 2) / 2;      // seat spreads ~4% when sitting (estimate)
          out.seated_method = "photo";
        } else warnings.push("Sitting photo looked unusual; sitting fit was estimated instead.");
      } catch (e) { warnings.push("Sitting photo could not be used; sitting fit was estimated instead."); }
    }
    if (out.seated_method === "estimated") { out.seated_waist = out.waist + 3; out.seated_hip = out.hip + 4; }
    out.shoulder = Math.round(f.shoulder * 2) / 2;
    for (const [k, [lo, hi]] of Object.entries(RANGES)) {
      if (out[k] < lo || out[k] > hi) { warnings.push(`${k} (${out[k]} cm) looks unusual. Please check it.`); }
    }
    out.warnings = [...new Set(warnings)];
    return out;
  }

  const api = { computeMeasurements, analyseSeated, ramanujan, runAt, topBottom };
  if (typeof module !== "undefined") module.exports = api; else window.SnugMeasureCore = api;
})();
