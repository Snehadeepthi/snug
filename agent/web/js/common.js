// Shared helpers: API calls, tiny markdown, and streaming an ADK agent run with live "agent steps".
window.Snug = (function () {
  const API = window.SNUG_API || "";
  const STEP_LABELS = {
    get_scanned_item: "Reading your scan", search_catalogue: "Searching the store", get_garment_details: "Looking at variants",
    get_fit_verdicts: "Checking fit on your phone", check_stock: "Checking stock", reserve_trial_room: "Holding a trial room",
    notify_staff: "Messaging staff", record_feedback: "Saving feedback", save_size_chart: "Validating & saving chart",
    suggest_pairings: "Finding matching pieces", get_fit_signals: "Reading fit signals", get_impact: "Measuring impact", get_stock: "Checking stock",
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function md(text) {
    const lines = esc(text).split("\n"); let html = "", inList = false;
    for (const raw of lines) {
      const line = raw.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
      if (/^\s*[-*•]\s+/.test(line)) { if (!inList) { html += "<ul>"; inList = true; } html += "<li>" + line.replace(/^\s*[-*•]\s+/, "") + "</li>"; }
      else { if (inList) { html += "</ul>"; inList = false; } if (line.trim()) html += "<p>" + line + "</p>"; }
    }
    return html + (inList ? "</ul>" : "");
  }
  async function j(url, opts) { const r = await fetch(API + url, opts); if (!r.ok) throw new Error(r.status + " " + (await r.text()).slice(0, 200)); return r.json(); }
  function store(key, val) { try { if (val === undefined) return JSON.parse(localStorage.getItem(key)); if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(val)); } catch { return null; } }
  function addMsg(box, role, html) { const d = document.createElement("div"); d.className = "msg " + role; d.innerHTML = html; box.appendChild(d); d.scrollIntoView({ block: "end", behavior: "smooth" }); return d; }

  function summarise(name, r) {
    try {
      if (r.error) return "error";
      switch (name) {
        case "search_catalogue": return `${r.count} found`;
        case "get_fit_verdicts": { const v = Object.values(r.verdicts || {}); const ok = v.filter((x) => x.verdict === "fits").length; return `${ok} fit · ${v.length - ok} don't`; }
        case "check_stock": return r.in_store_qty > 0 ? `${r.size}: ${r.in_store_qty} here` : `${r.size}: not here`;
        case "reserve_trial_room": return r.status === "held" ? `room ${r.room}` : "failed";
        case "notify_staff": return `sent · room ${r.room}`;
        case "get_scanned_item": return r.name ? `${r.name} (${r.scanned_size})` : "nothing scanned";
        case "save_size_chart": return r.status;
        case "suggest_pairings": return `${(r.pairs_well_with || []).length} ideas`;
        case "get_fit_signals": return `${(r.styles || []).length} styles`;
        case "get_impact": return `${r.wrong_size_tryons_avoided ?? 0} wrong sizes avoided`;
        default: return "done";
      }
    } catch { return "done"; }
  }

  async function createSession(app, uid, state) {
    const s = await j(`/apps/${app}/users/${uid}/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: state || {} }) });
    return s.id;
  }

  // Runs an agent turn. If the server restarted and lost the session (404), it creates a new one via
  // `recreate()` and retries once. Returns the session id actually used.
  async function runAgent({ app, uid, sessionId, parts, box, stateDelta, recreate }) {
    const steps = document.createElement("div"); steps.className = "steps"; box.appendChild(steps);
    const typing = document.createElement("div"); typing.className = "typing"; typing.textContent = "Snug is working…"; box.appendChild(typing);
    const chips = {};
    const body = { app_name: app, user_id: uid, session_id: sessionId, new_message: { role: "user", parts }, streaming: false };
    if (stateDelta) body.state_delta = stateDelta;
    const post = () => fetch(API + "/run_sse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let res;
    try { res = await post(); } catch { await new Promise((r) => setTimeout(r, 1500)); res = await post().catch(() => null); }
    if (res && res.status === 404 && recreate) { body.session_id = sessionId = await recreate(); res = await post(); }
    if (!res || !res.ok) {
      typing.remove(); if (!steps.children.length) steps.remove();
      const msg = !res ? "Can't reach Snug right now. Check your connection and try again."
        : res.status === 429 ? "Lots of people are using Snug right now. Please try again in a few seconds."
        : "Sorry, something went wrong (" + res.status + "). Please try again.";
      addMsg(box, "agent", esc(msg)); return sessionId;
    }
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
    const handle = (ev) => {
      if (ev.error) { addMsg(box, "agent", "Error: " + esc(ev.error)); return; }
      for (const p of ev.content?.parts || []) {
        if (p.functionCall) {
          const c = document.createElement("span"); c.className = "step";
          c.innerHTML = `<span class="dot"></span>${STEP_LABELS[p.functionCall.name] || p.functionCall.name}<span class="res"></span>`;
          steps.appendChild(c); (chips[p.functionCall.name] ||= []).push(c);
        } else if (p.functionResponse) {
          const c = (chips[p.functionResponse.name] || []).find((x) => !x.classList.contains("done"));
          if (c) { c.classList.add("done"); c.querySelector(".res").textContent = "· " + summarise(p.functionResponse.name, p.functionResponse.response || {}); }
        } else if (p.text && !ev.partial && ev.author !== "user" && !p.thought) {
          addMsg(box, "agent", md(p.text));
        }
      }
      box.appendChild(typing);
    };
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop();
      for (const line of lines) if (line.startsWith("data: ")) { try { handle(JSON.parse(line.slice(6))); } catch (e) { console.warn(e); } }
    }
    typing.remove(); if (!steps.children.length) steps.remove();
    return sessionId;
  }

  // <option>s for the store picker, grouped by city: <optgroup label="Mumbai">…
  function storeOptions(stores) {
    const byCity = {};
    for (const [id, s] of Object.entries(stores)) (byCity[s.city || "Other"] ||= []).push([id, s]);
    return Object.entries(byCity).map(([city, list]) => `<optgroup label="${esc(city)}">` +
      list.map(([id, s]) => `<option value="${esc(id)}">${esc(s.area || s.name)}, ${esc(city)}</option>`).join("") + "</optgroup>").join("");
  }

  // Units: measurements are always STORED in cm; the shopper can view and type them in cm or inches.
  const units = {
    get: () => store("snug_unit") || "cm",
    set: (u) => store("snug_unit", u === "in" ? "in" : "cm"),
    toU: (cm, u = units.get()) => (cm == null || cm === "" || isNaN(cm)) ? "" : u === "in" ? Math.round((cm / 2.54) * 4) / 4 : Math.round(cm * 2) / 2,
    fromU: (v, u = units.get()) => (v == null || v === "" || isNaN(v)) ? null : u === "in" ? Math.round(v * 2.54 * 2) / 2 : Number(v),
    fmt: (cm, u = units.get()) => u === "in" ? `${units.toU(cm, u)} in` : `${units.toU(cm, u)} cm`,
    fmtHeight: (cm, u = units.get()) => { if (u !== "in") return `${Math.round(cm)} cm`; const t = Math.round(cm / 2.54); return `${Math.floor(t / 12)} ft ${t % 12} in`; },
    step: (u = units.get()) => (u === "in" ? 0.25 : 0.5),
  };

  return { API, esc, md, j, store, addMsg, createSession, runAgent, storeOptions, units };
})();
