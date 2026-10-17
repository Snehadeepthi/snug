// Snug shopper app: Fit Passport (on-device body scan) -> scan tag -> instant fit verdict -> AI agent acts.
(function () {
  const { j, esc, md, store, addMsg, createSession, runAgent, units: U } = window.Snug;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const APP = "snug_agent";
  const HAD_PASSPORT_HASH = location.hash.includes("passport=");
  const S = {
    config: null, garments: null, profile: null, adding: false, pref: store("snug_pref") || "regular",
    storeId: store("snug_store") || null, uid: store("snug_uid") || ("shopper-" + Math.random().toString(36).slice(2, 9)),
    session: null, lastScan: null, qr: null, busy: false, frontFile: null, sideFile: null, seatedFile: null, greeted: false,
    room: null, lang: store("snug_lang") || "en-IN|English", facing: "user", stream: null, camStep: "front",
  };
  store("snug_uid", S.uid);

  // ---------- people: several Fit Passports on one phone (me, family, friends) ----------
  // Kept only in this phone's storage, like a single passport. The AI never sees any measurements.
  const newId = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  // Passports are kept per account on this phone ("guest" or a Firebase uid), so signing out or switching
  // accounts never shows someone else's passports.
  let ACCT = store("snug_acct") || "guest";
  const pkey = (a) => "snug_profiles:" + a;
  function loadProfiles(a) {
    const d = store(pkey(a));
    if (d && Array.isArray(d.list)) return d;
    const out = { list: [], active: null };
    if (a === ACCT) {                                                    // migrate older storage formats once
      const legacy = store("snug_profiles");
      if (legacy && Array.isArray(legacy.list)) { store("snug_profiles", null); return legacy; }
      const old = store("snug_profile");
      if (old) { const id = newId(); out.list.push({ ...old, id, name: old.name || "Me" }); out.active = id; store("snug_profile", null); }
    }
    return out;
  }
  let P = loadProfiles(ACCT);
  function persist() { store(pkey(ACCT), P); store("snug_acct", ACCT); }
  // Clear everything tied to the previous person: chat, scan, agent session, trial room.
  function resetShopping() {
    S.session = null; S.lastScan = null; S.greeted = false; S.room = null; store("snug_room", null);
    const chat = document.getElementById("chat"); if (chat) chat.innerHTML = "";
    if (S.config) chip();
  }
  function switchAccount(a) {
    if (a === ACCT) return;
    persist();
    let next = loadProfiles(a);
    if (a !== "guest" && !next.list.length) {                           // first sign-in on this phone: keep guest passports
      const g = loadProfiles("guest"); if (g.list.length) { next = g; store(pkey("guest"), null); }
    }
    ACCT = a; P = next; syncActive(); persist();
    S.adding = false; resetShopping(); renderMe();
  }
  function syncActive() { S.profile = P.list.find((x) => x.id === P.active) || P.list[0] || null; P.active = S.profile?.id || null; }
  syncActive(); persist();
  function activate(id) { P.active = id; syncActive(); persist(); S.session = null; refreshScan(); renderMe(); }
  // Re-run the fit engine for the last scanned tag whenever the person, their measurements or fit preference change,
  // so the verdict on screen and the verdicts sent to the agent always come from the current passport.
  function refreshScan() {
    if (!S.lastScan) return;
    if (!S.profile) { S.lastScan = null; return; }
    const { g, v } = S.lastScan; S.lastScan.v = SnugFit.verdictForScan(S.profile, g, v.scanned_size, S.pref);
    renderResult();
  }
  function addPerson(p, id) {                                    // add (or replace by id) and switch to it
    id ||= newId(); const i = P.list.findIndex((x) => x.id === id);
    const rec = { ...p, id, name: (p.name || "").trim().slice(0, 24) || (P.list.length ? "Person " + (P.list.length + 1) : "Me") };
    if (i >= 0) P.list[i] = rec; else P.list.push(rec);
    S.adding = false; activate(id);
  }
  function updateActive(p) { if (!S.profile) return addPerson(p); addPerson({ ...S.profile, ...p, name: p.name || S.profile.name }, S.profile.id); }
  function removeActive() { P.list = P.list.filter((x) => x.id !== P.active); P.active = P.list[0]?.id || null; syncActive(); persist(); S.session = null; refreshScan(); renderMe(); }
  const initial = (n) => esc((n || "?").trim()[0]?.toUpperCase() || "?");
  function renderPeople() {
    const bar = $("#peopleBar");
    bar.classList.toggle("hidden", !P.list.length);
    bar.innerHTML = P.list.map((x) => `<button class="person ${x.id === P.active && !S.adding ? "on" : ""}" data-person="${esc(x.id)}"><span class="av">${initial(x.name)}</span>${esc(x.name)}</button>`).join("") +
      `<button class="person add ${S.adding ? "on" : ""}" id="addPerson"><span class="av">+</span>Add person</button>`;
    const pc = $("#personChip"); pc.classList.toggle("hidden", !S.profile);
    if (S.profile) pc.textContent = "👤 " + (S.profile.name.length > 10 ? S.profile.name.slice(0, 9) + "…" : S.profile.name);
  }
  $("#peopleBar").onclick = (e) => {
    const b = e.target.closest("[data-person]"); if (b) { S.adding = false; activate(b.dataset.person); return; }
    if (e.target.closest("#addPerson")) { S.adding = true; renderMe(); }
  };
  $("#personChip").onclick = () => show("me");

  // ---------- navigation ----------
  function show(view) {
    $$(".view").forEach((v) => v.classList.toggle("hidden", v.id !== "view-" + view));
    $$(".bottomnav button").forEach((b) => b.classList.toggle("active", b.dataset.goto === view || (view === "result" && b.dataset.goto === "scan")));
    $("#chatForm").classList.toggle("hidden", view !== "ask");
    document.querySelector(".bottomnav").classList.toggle("hidden", view === "auth");
    if (view !== "scan") stopCamera();
    if (view === "ask") greet();
    window.scrollTo(0, 0);
  }
  document.addEventListener("click", (e) => {
    const g = e.target.closest("[data-goto]"); if (g) { e.preventDefault(); show(g.dataset.goto); }
    if (e.target.closest("[data-back]")) { renderMe(); }
  });

  // ---------- cm / inches ----------
  // Values are stored in cm. Switching converts whatever is typed in the open form, so nothing is lost.
  const UNIT_INPUTS = () => ["#scanHeight", "#estHeight", "#calibVal", "#accVal"].map((q) => $(q)).concat([...$$("#reviewFields input")]);
  function paintUnits() {
    const u = U.get();
    $$("[data-unit]").forEach((b) => b.classList.toggle("on", b.dataset.unit === u));
    $$(".u").forEach((x) => (x.textContent = u === "in" ? "in" : "cm"));
    UNIT_INPUTS().forEach((i) => i && (i.step = U.step(u)));
  }
  // Exact cm behind an input: kept while the shopper hasn't retyped it, so switching units never drifts.
  function readCm(i, u = U.get()) {
    if (!i || i.value === "") return null;
    return i.dataset.cm && i.value === i.dataset.shown ? Number(i.dataset.cm) : U.fromU(parseFloat(i.value), u);
  }
  function showCm(i, cm, u = U.get()) { if (!i) return; i.value = cm == null ? "" : U.toU(cm, u); i.dataset.cm = cm ?? ""; i.dataset.shown = i.value; }
  function setUnit(u) {
    const old = U.get(); if (u === old) return;
    UNIT_INPUTS().forEach((i) => { if (i && i.value !== "") showCm(i, readCm(i, old), u); });
    U.set(u); paintUnits(); if (S.profile && !S.adding) renderMe();
  }
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-unit]"); if (b) setUnit(b.dataset.unit); });
  const heightCm = (sel) => readCm($(sel));
  const heightOk = (cm) => cm >= 120 && cm <= 220;
  const askHeight = () => alert(U.get() === "in" ? "Please enter this person's real height in inches (e.g. 65 for 5 ft 5 in). Snug uses it as the ruler for every measurement."
                                                 : "Please enter this person's real height in cm (e.g. 165). Snug uses it as the ruler for every measurement.");

  // ---------- Fit Passport ----------
  const FIELDS = [["height", "Height"], ["chest", "Chest / bust"], ["waist", "Waist"], ["hip", "Hip"], ["inseam", "Inseam"], ["shoulder", "Shoulder"],
                  ["seated_waist", "Waist (sitting)"], ["seated_hip", "Hip (sitting)"]];
  function meSub(id) { ["#me-empty", "#me-scan", "#me-estimate", "#me-review", "#me-ready"].forEach((s) => $(s).classList.toggle("hidden", s !== id)); }
  function renderMe() {
    renderPeople();
    if (!S.profile || S.adding) {
      meSub("#me-empty");
      $("#emptyTitle").textContent = S.adding ? "Add a person" : "Your Fit Passport";
      $("#emptyLead").textContent = S.adding ? "Create a Fit Passport for a family member or friend. It stays on this phone, and you can switch between people any time."
        : "Scan your body once, privately at home. Then scan any clothing tag in a store and know your size instantly.";
      $("#cancelAdd").classList.toggle("hidden", !(S.adding && S.profile));
      return;
    }
    meSub("#me-ready");
    $("#ppName").textContent = `${S.profile.name}'s passport`;
    $("#ppMethod").textContent = ({ two_photos: "photo scan", front_only: "1-photo scan", manual: "entered manually", demo: "demo profile", estimated: "estimated from your sizes", kiosk: "in-store kiosk scan" }[S.profile.method] || "") + (S.profile.calibrated ? " · tape-calibrated" : "");
    $("#ppMeas").innerHTML = FIELDS.filter(([k]) => S.profile[k]).map(([k, l]) => `<div>${l}<b>${k === "height" ? U.fmtHeight(S.profile[k]) : U.fmt(S.profile[k])}</b></div>`).join("");
    paintUnits();
    $("#prefSelect").value = S.pref;
  }
  function review(values, { title, lead, warnings = [], method, retake = false }) {
    meSub("#me-review");
    const scanned = ["two_photos", "front_only", "kiosk"].includes(method);
    $("#calib").classList.toggle("hidden", !scanned); $("#calibMsg").textContent = ""; $("#calibVal").value = ""; $("#calib").dataset.done = "0";
    $("#reviewRetake").classList.toggle("hidden", !retake);
    $("#reviewTitle").textContent = title; $("#reviewLead").textContent = lead;
    $("#reviewWarn").classList.toggle("hidden", !warnings.length); $("#reviewWarn").innerHTML = warnings.map(esc).join("<br>");
    $("#reviewFields").innerHTML = FIELDS.map(([k, l]) => `<label class="field"><span>${l} (<span class="u">cm</span>)</span><input type="number" step="0.5" name="${k}" inputmode="decimal"></label>`).join("");
    $$("#reviewFields input").forEach((i) => showCm(i, values[i.name] ?? null));
    paintUnits();
    $("#reviewGender").value = values.gender || "women";
    $("#reviewName").value = values.name ?? (S.adding || !S.profile ? (P.list.length ? "" : (window.SnugAuth?.user?.name || "Me")) : S.profile.name);
    $("#saveProfile").textContent = S.adding || !S.profile ? "Save Fit Passport" : `Save ${S.profile.name}'s passport`;
    $("#saveProfile").onclick = () => {
      const p = { method, gender: $("#reviewGender").value, saved_at: Date.now(), name: $("#reviewName").value };
      if ($("#calib").dataset.done === "1") p.calibrated = true;
      $$("#reviewFields input").forEach((i) => { const v = readCm(i); if (v != null) p[i.name] = v; });
      if (!p.height || !p.chest || !p.waist) { alert("Height, chest and waist are needed."); return; }
      saveProfile(p);
    };
  }
  // One tape measurement scales the other scanned circumferences by the same ratio (scan error is mostly proportional).
  $("#calibGo").onclick = () => {
    const key = $("#calibPom").value, tape = readCm($("#calibVal"));
    const cur = {}; $$("#reviewFields input").forEach((i) => { const v = readCm(i); if (v != null) cur[i.name] = v; });
    const r = window.SnugMeasureCore.calibrate(cur, key, tape);
    if (!r) { $("#calibMsg").textContent = "Enter your tape value."; return; }
    $$("#reviewFields input").forEach((i) => { if (r.profile[i.name] != null) showCm(i, r.profile[i.name]); });
    const pct = Math.round((r.ratio - 1) * 1000) / 10; $("#calib").dataset.done = "1";
    $("#calibMsg").textContent = `Done: the scan was ${Math.abs(pct)}% ${pct > 0 ? "small" : "big"}, so the other measurements were adjusted by the same amount.` +
      (r.clamped ? " That's a large difference, so please retake the photos in fitted clothes." : "");
  };
  $("#reviewRetake").onclick = () => $("#startScan").click();
  function saveProfile(p) { if (S.adding || !S.profile) addPerson(p); else updateActive(p); }

  // Height is the ruler for the whole scan, so it is never carried over from someone else:
  // re-scanning a person starts from THEIR saved height; a new person starts blank.
  function prefillScanFor() {
    const me = !S.adding && S.profile ? S.profile : null;
    showCm($("#scanHeight"), me?.height ?? null); showCm($("#estHeight"), me?.height ?? null);
    $("#scanGender").value = me?.gender || "women"; $("#estGender").value = me?.gender || "women";
  }
  $("#startScan").onclick = () => { prefillScanFor(); S.frontFile = S.sideFile = S.seatedFile = null; $("#frontOk").classList.add("hidden"); $("#sideOk").classList.add("hidden"); $("#seatedOk").classList.add("hidden"); $("#scanStatus").classList.add("hidden"); meSub("#me-scan"); };
  $("#rescan").onclick = $("#startScan").onclick;
  $("#cancelAdd").onclick = () => { S.adding = false; renderMe(); };
  $("#editProfile").onclick = () => review({ ...S.profile }, { title: `Edit ${S.profile.name}'s passport`, lead: "Rename, or correct any measurement. Saved only on this phone.", method: S.profile.method });
  $("#startManual").onclick = () => review({}, { title: "Enter your measurements", lead: "Use a tape measure, in cm or inches (switch above). Saved only on this phone.", method: "manual" });
  async function addDemo(key) { const p = (await config()).profiles[key]; if (p) addPerson({ ...p, method: "demo", saved_at: Date.now() }, "demo-" + key); }
  $$("[data-demo]").forEach((b) => b.onclick = () => addDemo(b.dataset.demo));
  $("#frontFile").onchange = (e) => { S.frontFile = e.target.files[0] || null; $("#frontOk").classList.toggle("hidden", !S.frontFile); if (S.frontFile) $("#scanStatus").classList.add("hidden"); };
  $("#sideFile").onchange = (e) => { S.sideFile = e.target.files[0] || null; $("#sideOk").classList.toggle("hidden", !S.sideFile); };
  $("#seatedFile").onchange = (e) => { S.seatedFile = e.target.files[0] || null; $("#seatedOk").classList.toggle("hidden", !S.seatedFile); };
  // The button is always tappable: it explains what's missing instead of silently doing nothing,
  // and shows live progress (the body model is ~20 MB the first time on a phone).
  $("#runMeasure").onclick = async () => {
    if (S.measuring) return;
    const h = heightCm("#scanHeight"); const st = $("#scanStatus"), btn = $("#runMeasure");
    const say = (t) => { st.textContent = t; st.classList.remove("hidden"); st.scrollIntoView({ block: "center", behavior: "smooth" }); };
    if (!heightOk(h)) { askHeight(); $("#scanHeight").focus(); return; }
    if (!S.frontFile) { say("Add the front photo first: use the live camera guide above, or tap 1. Front photo."); return; }
    S.measuring = true; btn.disabled = true; const t0 = Date.now();
    say("Starting the body scan…");
    const tick = setInterval(() => {
      const sec = Math.round((Date.now() - t0) / 1000); btn.textContent = `Measuring… ${sec} s`;
      if (sec === 25) st.textContent += " (The first scan downloads the body model, about 20 MB. Keep this screen open.)";
    }, 1000);
    try {
      for (let i = 0; i < 50 && !window.SnugMeasure && !window.SnugMeasureLoadError; i++) await new Promise((r) => setTimeout(r, 200));
      if (!window.SnugMeasure) throw new Error("The body model could not load. Check your internet connection.");
      const m = await window.SnugMeasure.measureBody({ heightCm: h, frontFile: S.frontFile, sideFile: S.sideFile, seatedFile: S.seatedFile, onStatus: (t) => (st.textContent = t),
                                                       clothing: $("#scanClothes").value, shoes: $("#scanShoes").checked });
      S.frontFile = S.sideFile = S.seatedFile = null; $("#frontFile").value = ""; $("#sideFile").value = ""; $("#seatedFile").value = "";   // drop photo references
      $("#frontOk").classList.add("hidden"); $("#sideOk").classList.add("hidden"); $("#seatedOk").classList.add("hidden"); st.classList.add("hidden");
      review({ ...m, gender: $("#scanGender").value }, { title: "Your measurements", lead: "Measured on your phone; photos already deleted. For the best accuracy, calibrate with one tape measurement below.", warnings: m.warnings, method: m.method, retake: m.quality_ok === false });
    } catch (err) {
      say("Couldn't measure: " + err.message + " You can retake the photos, or go back and choose “Enter my measurements”.");
    } finally {
      clearInterval(tick); S.measuring = false; btn.disabled = false; btn.textContent = "Measure me";
    }
  };
  $("#toggleMeas").onclick = () => { const h = $("#ppMeas").classList.toggle("hidden"); $("#toggleMeas").textContent = h ? "Show measurements" : "Hide measurements"; };
  $("#deleteProfile").onclick = () => { if (confirm(`Delete ${S.profile.name}'s Fit Passport from this phone?`)) removeActive(); };
  $("#prefSelect").onchange = (e) => { S.pref = e.target.value; store("snug_pref", S.pref); S.session = null; refreshScan(); };

  // ---------- store ----------
  async function config() { return (S.config ||= await j("/api/config")); }
  function setStore(id) { S.storeId = id; store("snug_store", id); S.session = null; $("#storeSelect").value = id; chip(); }
  function chip() { const st = S.config.stores[S.storeId]; $("#storeChip").textContent = "📍 " + (st ? `${st.area}, ${st.city}` : S.storeId) + (S.room ? " · Room " + S.room : ""); }
  // "Use my location": pick the nearest Snug store (location is used on the phone only, never sent anywhere)
  $("#nearMe").onclick = () => {
    const out = $("#nearMeMsg"); out.textContent = "Finding the nearest store…";
    if (!navigator.geolocation) { out.textContent = "Location isn't available on this device; choose your store from the list."; return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude: la, longitude: lo } = pos.coords, R = 6371, rad = (d) => d * Math.PI / 180;
      const dist = (s) => 2 * R * Math.asin(Math.sqrt(Math.sin(rad(s.lat - la) / 2) ** 2 + Math.cos(rad(la)) * Math.cos(rad(s.lat)) * Math.sin(rad(s.lng - lo) / 2) ** 2));
      const [id, st] = Object.entries(S.config.stores).sort((a, b) => dist(a[1]) - dist(b[1]))[0];
      setStore(id); out.textContent = `Nearest store: ${st.area}, ${st.city} (${Math.round(dist(st))} km away).`;
    }, () => { out.textContent = "Couldn't get your location. Please choose your store from the list."; }, { timeout: 10000, maximumAge: 600000 });
  };
  // "Mirror Tap": a trial-room QR / NFC tag opens /app/?store=BLR-07&room=4
  function applyRoom(storeId, room) {
    if (storeId && S.config.stores[storeId]) setStore(storeId);
    if (room && (S.config.stores[S.storeId]?.trial_rooms || []).includes(String(room))) {
      S.room = String(room); store("snug_room", { room: S.room, store: S.storeId, t: Date.now() }); chip(); return true;
    }
    return false;
  }
  $("#storeSelect").onchange = (e) => setStore(e.target.value);
  $("#storeChip").onclick = () => show("me");

  // ---------- scan a tag ----------
  function scanErr(msg) { $("#scanErr").classList.toggle("hidden", !msg); $("#scanErr").innerHTML = msg || ""; }
  function qr() {
    if (!S.qr) {
      const F = Html5QrcodeSupportedFormats;
      S.qr = new Html5Qrcode("reader", { formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.CODE_128, F.QR_CODE], verbose: false,
                                         experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
    }
    return S.qr;
  }
  async function stopCamera() { try { if (S.qr?.isScanning) await S.qr.stop(); } catch {} $("#camStart").classList.remove("hidden"); $("#camStop").classList.add("hidden"); }
  $("#camStart").onclick = async () => {
    scanErr("");
    try {
      await qr().start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 280, height: 150 } }, (code) => { stopCamera(); handleCode(code); });
      $("#camStart").classList.add("hidden"); $("#camStop").classList.remove("hidden");
    } catch (e) { scanErr("Camera not available (" + esc(e?.message || e) + "). Use a photo of the tag or type the number."); }
  };
  $("#camStop").onclick = stopCamera;
  $("#tagPhoto").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return; scanErr(""); await stopCamera();
    try { const code = await qr().scanFile(f, false); handleCode(code); } catch { scanErr("No barcode found in that photo. Try again closer, or type the number."); }
    e.target.value = "";
  };
  $("#manualGo").onclick = () => { const c = $("#manualCode").value.replace(/\D/g, ""); if (c) handleCode(c); };

  async function handleCode(code) {
    if (/^https?:\/\//.test(code) || code.includes("room=")) {           // trial-room QR
      try {
        const u = new URL(code, location.href);
        if (applyRoom(u.searchParams.get("store"), u.searchParams.get("room"))) {
          scanErr(""); show("ask");
          addMsg($("#chat"), "agent", md(`You're in **Room ${S.room}**. Scan a tag and I'll get the right size sent here.`));
          return;
        }
      } catch {}
      scanErr("That QR isn't a Snug trial-room code."); return;
    }
    if (!S.profile) { scanErr('Create your Fit Passport first. <a href="#" data-goto="me">Go to Passport</a>'); show("scan"); return; }
    try {
      const { garment: g, scanned_size } = await j("/api/garments/by-gtin/" + encodeURIComponent(code.trim()));
      const v = SnugFit.verdictForScan(S.profile, g, scanned_size, S.pref);
      S.lastScan = { g, v, code };
      renderResult(); show("result");
      fetch(window.Snug.API + "/api/events", { method: "POST", headers: { "Content-Type": "application/json" },   // anonymous: no body data
        body: JSON.stringify({ type: "scan", store_id: S.storeId, style_id: g.style_id, scanned_size: scanned_size,
                               recommended_size: v.recommendation.size, verdict: v.recommendation.verdict }) }).catch(() => {});
    } catch (e) { scanErr(e.message.startsWith("404") ? "This barcode isn't in Snug's catalogue yet." : "Lookup failed: " + esc(e.message)); show("scan"); }
  }

  // ---------- fit result ----------
  function barPos(p, g) {
    let lo, hi;
    if (p.pom === "length" || p.pom === "inseam") { lo = -5; hi = 5; }
    else { lo = -1.5; hi = g.fit_type === "oversized" ? 10 : 6; }
    const d = p.delta_cm;
    if (d < lo) return Math.max(2, 40 - ((lo - d) / 10) * 40);
    if (d > hi) return Math.min(98, 60 + ((d - hi) / 10) * 40);
    return 40 + ((d - lo) / (hi - lo)) * 20;
  }
  function renderResult() {
    const { g, v } = S.lastScan, rec = v.recommendation;
    $("#rBrand").textContent = g.brand; $("#rName").textContent = g.name;
    $("#rMeta").innerHTML = `₹${g.price_inr.toLocaleString("en-IN")} · ${esc(g.fit_type)} fit · ${esc(g.fabric)} · tag size <b>${esc(v.scanned_size)}</b>`;
    const cls = rec.verdict === "no_good_fit" ? "bad" : rec.size === v.scanned_size ? "good" : "swap";
    const extra = rec.verdict === "fits" && rec.notes.length ? `Size ${rec.size}: ${rec.notes.join(", ")}` : rec.between_sizes && rec.size === v.scanned_size ? `You're between ${rec.size} and ${rec.between_sizes}.` : "";
    $("#rVerdict").className = "verdict " + cls; $("#rVerdict").innerHTML = esc(v.headline) + (extra ? `<small>${esc(extra)}</small>` : "");
    $("#rScanned").textContent = v.scanned_size;
    $("#rFor").innerHTML = P.list.length > 1 ? `Checking for <b>${esc(S.profile.name)}</b>` : "";
    $("#rFamily").classList.toggle("hidden", P.list.length < 2);
    if (P.list.length > 1) {
      $("#rFamily").innerHTML = `<b>👨‍👩‍👧 Sizes for everyone</b><span class="small muted"> · tap a name to switch</span>` + P.list.map((x) => {
        const r = SnugFit.verdictForScan(x, g, v.scanned_size, S.pref).recommendation;
        const other = g.gender !== "unisex" && x.gender !== g.gender ? ` <span class="muted">(${esc(g.gender)}'s style)</span>` : "";
        const txt = r.verdict === "no_good_fit" ? `no good fit (closest ${esc(r.size)})` : r.size === v.scanned_size ? `size ${esc(r.size)} ✓ this tag` : `size ${esc(r.size)}`;
        return `<button class="famrow ${x.id === P.active ? "on" : ""}" data-fam="${esc(x.id)}"><span class="av">${initial(x.name)}</span><span>${esc(x.name)}${other}</span><b>${txt}</b></button>`;
      }).join("");
    }
    const sp = v.scanned_seated || [];
    $("#rSitting").classList.toggle("hidden", !sp.length);
    if (sp.length) {
      const bad = sp.filter((p) => p.status !== "ok"), est = sp.some((p) => p.estimated);
      const top = !["jeans", "trousers"].includes(g.category);
      $("#rSitting").innerHTML = `<b>🪑 Sitting check · size ${esc(v.scanned_size)}</b><br>` +
        (bad.length ? `When you sit, it ${esc(SnugFit.sitPhrase(bad, g.category))}.`
                    : top ? "Comfortable when you sit: no pulling at the buttons or riding up." : "Comfortable when you sit, no digging in at the waist or hip.") +
        `<br><span class="small muted">${est ? "Estimated. Add a sitting photo to your Fit Passport for a precise check." : S.profile?.method === "demo" ? "Using the demo shopper's sitting measurements." : "Based on your sitting measurements."}</span>`;
    }
    const ends = (pom) => (pom === "length" || pom === "inseam") ? ["short", "long"] : ["tight", "loose"];
    $("#rBars").innerHTML = v.scanned_points.map((p) => {
      const [a, b] = ends(p.pom); const label = p.status === "ok" ? "good" : `${(Math.abs(p.delta_cm) / 2.54).toFixed(1)} in ${p.status}`;
      return `<div class="fitbar"><div class="lbl"><span>${esc(p.pom)}</span><b>${label}</b></div><div class="track"><span class="dot" style="left:${barPos(p, g)}%"></span></div><div class="ends"><span>${a}</span><span>${b}</span></div></div>`;
    }).join("");
    $("#rSizes").innerHTML = v.all_sizes.map((s) => {
      const bad = s.points.find((p) => p.status !== "ok");
      const sat = (s.seated_points || []).find((p) => p.status !== "ok");
      return `<div class="size ${s.size === rec.size ? "best" : ""} ${s.size === v.scanned_size ? "scanned" : ""}"><b>${esc(s.size)}</b>${s.size === rec.size ? "best" : bad ? esc(bad.status) : sat ? "tight sitting" : "ok"}</div>`;
    }).join("");
    $("#rAction").textContent = cls === "swap" ? `Get size ${rec.size} for me` : cls === "good" ? "Hold it in a trial room" : "Find something similar that fits";
  }
  $("#rAction").onclick = () => {
    const { g, v } = S.lastScan, rec = v.recommendation;
    const msg = rec.verdict === "no_good_fit" ? `The ${g.name} doesn't fit me in any size. Find me something similar that fits and is in stock here.`
      : rec.size !== v.scanned_size ? `I scanned the ${g.name} in size ${v.scanned_size}. Please get me size ${rec.size}.`
      : `I scanned the ${g.name} in size ${v.scanned_size} and it fits. Can you hold it in a trial room for me?`;
    show("ask"); send(msg);
  };
  $("#rFamily").onclick = (e) => {
    const b = e.target.closest("[data-fam]"); if (!b || b.dataset.fam === P.active || !S.lastScan) return;
    activate(b.dataset.fam);
  };
  $("#rAsk").onclick = () => { show("ask"); $("#chatInput").focus(); };

  // ---------- Ask Snug (agent) ----------
  async function garments() { return (S.garments ||= await j("/api/garments")); }
  async function agentState() {
    const s = { store_id: S.storeId, gender: S.profile?.gender || "", language: S.lang.split("|")[1] };
    if (S.room) s.qr_room = S.room;
    if (S.profile) s.shopping_for = S.profile.name;                                    // a first name only
    if (S.profile) s.fit_verdicts = SnugFit.verdictMap(S.profile, await garments(), S.pref);   // verdicts only, no body numbers
    if (S.lastScan) {
      const { g, v } = S.lastScan;
      s.scanned = { style_id: g.style_id, name: g.name, scanned_size: v.scanned_size, verdict: v.headline,
                    recommended_size: v.recommendation.size, confidence: v.recommendation.confidence, notes: v.recommendation.notes };
    }
    return s;
  }
  function greet() {
    if (S.greeted) return; S.greeted = true;
    addMsg($("#chat"), "agent", md("Hi! I'm **Snug**. Scan a tag and I'll get you the right size, or tell me what you're shopping for. You can type or speak in your language."));
  }
  async function send(text) {
    text = text.trim(); if (!text || S.busy) return;
    if (!S.profile) { addMsg($("#chat"), "agent", md("Please create your **Fit Passport** first (Passport tab).")); return; }
    S.busy = true; $("#chatForm button").disabled = true;
    addMsg($("#chat"), "user", esc(text)); $("#chatInput").value = "";
    try {
      const st = await agentState();
      S.session ||= await createSession(APP, S.uid, st);
      const langName = S.lang.split("|")[1];
      const sendText = langName === "English" ? text : `(Reply in ${langName}) ${text}`;
      S.session = await runAgent({ app: APP, uid: S.uid, sessionId: S.session, parts: [{ text: sendText }], box: $("#chat"), stateDelta: st,
                                   recreate: () => createSession(APP, S.uid, st) });
      speakLast();
    } catch (e) { addMsg($("#chat"), "agent", "Connection problem: " + esc(e.message)); }
    S.busy = false; $("#chatForm button").disabled = false;
  }
  $("#chatForm").onsubmit = (e) => { e.preventDefault(); send($("#chatInput").value); };
  $("#suggestions").onclick = (e) => { if (e.target.tagName === "BUTTON") send(e.target.textContent); };

  // ---------- language: voice input + read aloud ----------
  $("#langSelect").value = S.lang;
  $("#langSelect").onchange = (e) => { S.lang = e.target.value; store("snug_lang", S.lang); };
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) $("#micBtn").classList.add("hidden");
  $("#micBtn").onclick = () => {
    if (!SR) return;
    const rec = new SR(); rec.lang = S.lang.split("|")[0]; rec.interimResults = false; rec.maxAlternatives = 1;
    $("#micBtn").classList.add("listening");
    rec.onresult = (e) => { const t = e.results[0][0].transcript; $("#chatInput").value = t; send(t); };
    rec.onerror = () => {}; rec.onend = () => $("#micBtn").classList.remove("listening");
    rec.start();
  };
  function speakLast() {
    if (!$("#speakToggle").checked || !window.speechSynthesis) return;
    const msgs = document.querySelectorAll("#chat .msg.agent"); const last = msgs[msgs.length - 1]; if (!last) return;
    const u = new SpeechSynthesisUtterance(last.textContent); u.lang = S.lang.split("|")[0];
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }

  // ---------- no-scan estimate from sizes you already wear ----------
  const GENERIC = {
    women: { top: { XS: { chest: 81, waist: 66, hip: 89 }, S: { chest: 86, waist: 70, hip: 94 }, M: { chest: 91, waist: 75, hip: 99 },
                    L: { chest: 97, waist: 81, hip: 104 }, XL: { chest: 102, waist: 86, hip: 109 } } },
    men: { top: { S: { chest: 92, waist: 78, hip: 94 }, M: { chest: 98, waist: 84, hip: 100 }, L: { chest: 104, waist: 90, hip: 106 },
                  XL: { chest: 110, waist: 96, hip: 112 } } },
  };
  const TOPS = ["kurta", "shirt", "tshirt", "dress", "blazer"], BOTTOMS = ["jeans", "trousers"];
  const EASE_EST = { "kurta|regular": { chest: 10, waist: 12, hip: 12 }, "kurta|slim": { chest: 6, waist: 6, hip: 8 }, "shirt|slim": { chest: 8, waist: 8 },
    "shirt|regular": { chest: 12, waist: 14 }, "tshirt|regular": { chest: 8 }, "tshirt|oversized": { chest: 18 }, "dress|fitted": { chest: 5, waist: 4, hip: 5 },
    "dress|relaxed": { chest: 10, waist: 12, hip: 12 }, "jeans|slim": { waist: 1, hip: 3 }, "jeans|regular": { waist: 2, hip: 6 },
    "trousers|regular": { waist: 2.5, hip: 6 }, "blazer|regular": { chest: 10, waist: 10 } };
  function brandsFor(gender) { return [...new Set((S.garments || []).filter((g) => g.gender === gender || g.gender === "unisex").map((g) => g.brand))]; }
  function sizesFor(gender, brand, kind) {
    if (brand === "generic") return kind === "top" ? Object.keys(GENERIC[gender].top) : ["26", "28", "30", "32", "34", "36"];
    const cats = kind === "top" ? TOPS : BOTTOMS;
    return SnugFit.sortSizes([...new Set((S.garments || []).filter((g) => g.brand === brand && cats.includes(g.category)).flatMap((g) => Object.keys(g.sizes)))]);
  }
  function estRow(i) {
    const gender = $("#estGender").value;
    const opts = ['<option value="generic">Typical sizes</option>', ...brandsFor(gender).map((b) => `<option>${esc(b)}</option>`)].join("");
    return `<div class="est-item" data-i="${i}"><b class="small">Item ${i + 1}${i ? " (optional)" : ""}</b><div class="grid3x">
      <select data-k="kind"><option value="top">Top / dress</option><option value="bottom">Bottoms</option></select>
      <select data-k="brand">${opts}</select><select data-k="size"></select></div>
      <select data-k="feel" style="margin-top:6px"><option value="right">Fits me just right</option><option value="tight">A bit tight on me</option><option value="loose">A bit loose on me</option></select></div>`;
  }
  function refreshSizes(row) {
    const g = $("#estGender").value, k = row.querySelector('[data-k=kind]').value, b = row.querySelector('[data-k=brand]').value;
    const sizes = sizesFor(g, b, k);
    row.querySelector('[data-k=size]').innerHTML = (row.dataset.i !== "0" ? '<option value="">—</option>' : "") + sizes.map((x) => `<option>${x}</option>`).join("");
  }
  async function openEstimate() {
    await garments(); meSub("#me-estimate");
    $("#estItems").innerHTML = estRow(0) + estRow(1);
    $$("#estItems .est-item").forEach((r) => { refreshSizes(r); r.querySelectorAll("select").forEach((x) => { if (x.dataset.k !== "size" && x.dataset.k !== "feel") x.onchange = () => refreshSizes(r); }); });
    $("#estItems .est-item:nth-child(2) [data-k=kind]").value = "bottom"; refreshSizes($("#estItems .est-item:nth-child(2)"));
  }
  $("#startEstimate").onclick = () => { prefillScanFor(); openEstimate(); };
  $("#estGender").onchange = openEstimate;
  $("#runEstimate").onclick = () => {
    const gender = $("#estGender").value, height = heightCm("#estHeight");
    if (!heightOk(height)) { askHeight(); return; }
    const acc = {}; const add = (k, v) => { (acc[k] ||= []).push(v); };
    $$("#estItems .est-item").forEach((row) => {
      const kind = row.querySelector('[data-k=kind]').value, brand = row.querySelector('[data-k=brand]').value;
      const size = row.querySelector('[data-k=size]').value, feel = row.querySelector('[data-k=feel]').value;
      if (!size) return;
      const adj = feel === "tight" ? 2 : feel === "loose" ? -2.5 : 0;
      if (brand === "generic") {
        if (kind === "top") Object.entries(GENERIC[gender].top[size]).forEach(([k, v]) => add(k, v + adj));
        else { const w = parseInt(size) * 2.54; add("waist", w + adj); add("hip", w + (gender === "women" ? 24 : 14) + adj); }
        return;
      }
      const cats = kind === "top" ? TOPS : BOTTOMS;
      for (const g of S.garments.filter((x) => x.brand === brand && cats.includes(x.category) && x.sizes[size])) {
        const e = EASE_EST[`${g.category}|${g.fit_type}`] || {};
        for (const [k, v] of Object.entries(g.sizes[size])) {
          if (k === "inseam") add("inseam", v);
          else if (k in e) add(k, v - e[k] + adj);
        }
      }
    });
    const avg = (k) => acc[k]?.length ? Math.round((acc[k].reduce((a, b) => a + b, 0) / acc[k].length) * 2) / 2 : undefined;
    const est = { height, gender, chest: avg("chest"), waist: avg("waist"), hip: avg("hip"),
                  inseam: avg("inseam") || Math.round(height * (gender === "women" ? 0.455 : 0.46) * 2) / 2 };
    if (!est.chest && est.waist) est.chest = Math.round((est.waist + (gender === "women" ? 16 : 14)) * 2) / 2;
    if (!est.waist && est.chest) est.waist = Math.round((est.chest - (gender === "women" ? 16 : 14)) * 2) / 2;
    if (!est.hip && est.waist) est.hip = Math.round((est.waist + (gender === "women" ? 24 : 14)) * 2) / 2;
    review(est, { title: "Your estimated measurements", lead: "Estimated from sizes you wear. Adjust if you know better.",
                  warnings: ["Estimates are less accurate than a 2-photo scan. You can scan any time from your Passport."], method: "estimated" });
  };

  // ---------- live camera guide for the body scan ----------
  const GUIDE = {
    front: '<circle cx="50" cy="20" r="11"/><path d="M50 31v62M50 40l-26 34M50 40l26 34M50 93l-15 95M50 93l15 95M36 38h28M38 93h24"/>',
    side: '<circle cx="50" cy="20" r="11"/><path d="M50 31v62M50 40l4 48M50 93l-4 95M50 93l5 95M42 40c-4 20-4 40 0 53M58 40c6 20 6 40 0 53"/>',
    seated: '<circle cx="40" cy="45" r="11"/><path d="M40 56v52M40 108h40M80 108v70M34 72l20 8M20 178h80M22 108v70"/>',
  };
  function beep(f = 880) { try { const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(); o.frequency.value = f; o.connect(a.destination); o.start(); setTimeout(() => { o.stop(); a.close(); }, 120); } catch {} }
  async function startStream() {
    stopStream();
    S.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: S.facing, width: { ideal: 1280 }, height: { ideal: 1920 } }, audio: false });
    const v = $("#camVideo"); v.srcObject = S.stream; v.style.transform = S.facing === "user" ? "scaleX(-1)" : ""; await v.play();
  }
  function stopStream() { S.stream?.getTracks().forEach((t) => t.stop()); S.stream = null; }
  function camStep(step) {
    S.camStep = step; $("#camGuide").innerHTML = GUIDE[step];
    $("#camTitle").textContent = { front: "1 of 3 · Front photo", side: "2 of 3 · Side photo", seated: "3 of 3 · Sitting photo" }[step];
    $("#camHint").textContent = { front: "Face the camera, arms slightly out. Fit your whole body in the outline.", side: "Turn 90° to your side, arms down.",
                                  seated: "Sit upright on a chair, side-on, arms crossed on your chest. Checks how shirts, kurtas, jeans and trousers fit when you sit." }[step];
    $("#camSkip").classList.toggle("hidden", step !== "seated");
  }
  $("#openCam").onclick = async () => {
    const h = heightCm("#scanHeight"); if (!heightOk(h)) { askHeight(); return; }
    $("#camView").classList.remove("hidden"); camStep("front");
    try { await startStream(); } catch (e) { $("#camView").classList.add("hidden"); alert("Camera not available: " + (e.message || e) + ". Upload photos instead."); }
  };
  $("#camFlip").onclick = async () => { S.facing = S.facing === "user" ? "environment" : "user"; try { await startStream(); } catch {} };
  $("#camCancel").onclick = () => { stopStream(); $("#camView").classList.add("hidden"); };
  $("#camSkip").onclick = () => { stopStream(); $("#camView").classList.add("hidden"); $("#runMeasure").click(); };
  $("#camShoot").onclick = async () => {
    $("#camShoot").disabled = true; const c = $("#camCount"); c.classList.remove("hidden");
    for (let n = 5; n > 0; n--) { c.textContent = n; beep(660); await new Promise((r) => setTimeout(r, 1000)); }
    c.classList.add("hidden"); beep(1200);
    const v = $("#camVideo"); const cv = document.createElement("canvas"); cv.width = v.videoWidth; cv.height = v.videoHeight;
    cv.getContext("2d").drawImage(v, 0, 0);
    const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.92)); cv.width = cv.height = 0;
    $("#camShoot").disabled = false;
    if (S.camStep === "front") { S.frontFile = blob; $("#frontOk").classList.remove("hidden"); camStep("side"); }
    else if (S.camStep === "side") { S.sideFile = blob; $("#sideOk").classList.remove("hidden"); camStep("seated"); }
    else { S.seatedFile = blob; $("#seatedOk").classList.remove("hidden"); stopStream(); $("#camView").classList.add("hidden"); $("#runMeasure").click(); }
  };

  // ---------- accuracy check against a tape measure ----------
  $("#openAccuracy").onclick = () => $("#accuracy").classList.toggle("hidden");
  $("#accGo").onclick = () => {
    const pom = $("#accPom").value, tape = readCm($("#accVal")), scan = S.profile?.[pom];
    if (!(tape > 0) || !scan) { $("#accOut").classList.remove("hidden"); $("#accOut").textContent = "Enter a tape value (and make sure your passport has this measurement)."; return; }
    const diff = Math.round((scan - tape) * 10) / 10, pct = Math.round((Math.abs(diff) / tape) * 1000) / 10;
    $("#accOut").classList.remove("hidden");
    $("#accOut").innerHTML = `Snug: <b>${U.fmt(scan)}</b> · Tape: <b>${U.fmt(tape)}</b> · Difference <b>${diff > 0 ? "+" : diff < 0 ? "−" : ""}${U.fmt(Math.abs(diff))} (${pct}%)</b>. ` +
      (pct <= 3 ? "Great, that's very close." : pct <= 6 ? "Close. Using your tape value will make fits more precise." : "That's a big gap; try re-scanning in fitted clothes, or use your tape value.");
    $("#accUse").classList.remove("hidden"); $("#accUse").onclick = () => { updateActive({ [pom]: tape }); $("#accuracy").classList.add("hidden"); };
    const canScale = ["chest", "waist", "hip"].includes(pom);
    $("#accScale").classList.toggle("hidden", !canScale);
    $("#accScale").onclick = () => { const r = window.SnugMeasureCore.calibrate(S.profile, pom, tape); if (r) updateActive({ ...r.profile, calibrated: true }); $("#accuracy").classList.add("hidden"); };
    fetch(window.Snug.API + "/api/events", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "accuracy_check", store_id: S.storeId, error_pct: pct }) }).catch(() => {});
  };

  // ---------- install as an app (PWA) ----------
  let installEvt = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; $("#installBtn").classList.remove("hidden"); });
  $("#installBtn").onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $("#installBtn").classList.add("hidden"); };
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((r) => r.update()).catch(() => {});
  if (window.caches) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});   // drop old offline copies

  // Full reset: passports, settings, sign-in, cached files and the service worker, then a fresh reload.
  $("#resetApp").onclick = async () => {
    if (!confirm("Reset Snug on this phone? This deletes all Fit Passports saved here, signs you out and reloads the latest version.")) return;
    try { await window.SnugAuth?.signOut?.(); } catch {}
    try { Object.keys(localStorage).filter((k) => k.startsWith("snug_")).forEach((k) => localStorage.removeItem(k)); sessionStorage.clear(); } catch {}
    try { if (window.caches) for (const k of await caches.keys()) await caches.delete(k); } catch {}
    try { for (const r of (await navigator.serviceWorker?.getRegistrations?.()) || []) await r.unregister(); } catch {}
    location.replace(location.pathname + "?fresh=" + Date.now());
  };

  // ---------- account (sign in / sign up via js/auth.js) ----------
  let authSeen = false;
  function renderAcct() {
    const u = window.SnugAuth?.user;
    $("#acctCard").innerHTML = u
      ? `<div class="who"><span class="av">${esc((u.name || u.email || "S")[0].toUpperCase())}</span><span><b>${esc(u.name || "Signed in")}</b> · ${esc(u.phone || u.email)}</span></div><button id="acctOut">Sign out</button>`
      : `<div class="who"><span class="av">👋</span><span>You're using Snug as a <b>guest</b></span></div><button id="acctIn">Sign in / Sign up</button>`;
    $("#acctOut")?.addEventListener("click", async () => { await window.SnugAuth.signOut(); store("snug_guest", null); show("auth"); });
    $("#acctIn")?.addEventListener("click", () => show("auth"));
  }
  window.addEventListener("snug-auth-changed", () => {
    const u = window.SnugAuth?.user;
    if (u) { const id = "user-" + u.uid; if (S.uid !== id) { S.uid = id; S.session = null; } switchAccount(u.uid); }   // agent sessions follow the account
    else if (window.SnugAuth?.ready && ACCT !== "guest") {              // signed out: new anonymous id, guest passports only
      S.uid = "shopper-" + Math.random().toString(36).slice(2, 9); store("snug_uid", S.uid); switchAccount("guest");
    }
    if (u?.name) { const me = P.list.find((x) => x.name === "Me"); if (me) { me.name = u.name.split(" ")[0].slice(0, 24); persist(); syncActive(); renderMe(); } }
    renderAcct();
    if (!authSeen) {
      authSeen = true;
      const qp = new URLSearchParams(location.search);
      const skip = qp.get("demo") || qp.get("room") || HAD_PASSPORT_HASH || store("snug_guest");
      if (!u && !skip && window.SnugAuth?.configured) show("auth");      // first visit: offer sign in / sign up
    }
  });
  window.addEventListener("snug-auth-done", () => {
    store("snug_guest", null); renderMe(); show("me");
    const w = window.SnugAuth?.welcome; if (!w) return; window.SnugAuth.welcome = null;
    const note = $("#welcomeNote");
    note.innerHTML = `🎉 <b>Welcome to Snug, ${esc(w.name)}!</b> Your account is created. ` +
      (w.failed ? "We couldn't send the confirmation email right now." : `We've sent a confirmation email to <b>${esc(w.email)}</b> (check Spam if you don't see it).`);
    note.classList.remove("hidden"); setTimeout(() => note.classList.add("hidden"), 15000);
  });
  $("#continueGuest").onclick = () => { store("snug_guest", true); renderAcct(); show("me"); };
  renderAcct();

  // ---------- start ----------
  ["#scanHeight", "#estHeight"].forEach((q) => showCm($(q), null));   // no shared default height
  paintUnits();
  (async function init() {
    const c = await config();
    $("#storeSelect").innerHTML = window.Snug.storeOptions(c.stores);
    setStore(S.storeId && c.stores[S.storeId] ? S.storeId : c.default_store);
    const saved = store("snug_room");
    if (saved && Date.now() - saved.t < 3 * 3600e3) applyRoom(saved.store, saved.room);
    const qp = new URLSearchParams(location.search);
    // Fit Passport handed over from the store kiosk QR: it arrives in the #fragment (never sent to any server).
    const hm = location.hash.match(/passport=([A-Za-z0-9_-]+)/);
    if (hm) {
      try {
        const raw = JSON.parse(decodeURIComponent(escape(atob(hm[1].replace(/-/g, "+").replace(/_/g, "/")))));
        const p = { method: "kiosk", saved_at: Date.now(), gender: raw.gender === "men" ? "men" : "women" };
        for (const k of ["height", "chest", "waist", "hip", "inseam", "shoulder", "seated_waist", "seated_hip"]) { const v = Number(raw[k]); if (v > 20 && v < 250) p[k] = v; }
        p.name = typeof raw.name === "string" ? raw.name.replace(/[<>]/g, "").trim().slice(0, 24) : "";
        if (!p.name) p.name = P.list.length ? "Kiosk scan" : "Me";
        if (p.height && p.chest && p.waist) { addPerson(p); S.kioskImported = true; }
      } catch {}
      history.replaceState(null, "", location.pathname + location.search);
    }
    if (qp.get("demo") && c.profiles[qp.get("demo")]) await addDemo(qp.get("demo"));
    if (qp.get("room")) applyRoom(qp.get("store"), qp.get("room"));
    renderMe();
    if (S.kioskImported) { $("#ppName").textContent = `${S.profile.name}'s passport saved from the kiosk ✓`; }
    if (S.room && qp.get("room")) { show("ask"); addMsg($("#chat"), "agent", md(S.profile ? `Welcome to **Room ${S.room}**! Scan a tag and I'll check your fit and get the right size sent here.` : `Welcome to **Room ${S.room}**! Create your **Fit Passport** first (Passport tab).`)); }
    const code = new URLSearchParams(location.search).get("code");   // tags can link straight to a scan
    if (code && S.profile) handleCode(code);
    garments().catch(() => {});
  })();
})();
