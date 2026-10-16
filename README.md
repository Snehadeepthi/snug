# Snug: your Fit Passport (the right size, first try)

**Live demo:** https://snug-5zcsxlm5za-el.a.run.app/ (evaluator guide) · app: https://snug-5zcsxlm5za-el.a.run.app/app/

**Scan your body once, privately at home. In any store, scan the barcode on a price tag and instantly see if that size fits. Then Snug's AI agent gets you the right size.**

1. **One-time private body scan.** Three phone photos (front, side and an optional sitting photo). Google MediaPipe runs *on the phone* and turns the body outline into measurements (chest, waist, hip, inseam). Photos are wiped instantly; only numbers are kept, on the phone.
2. **Scan the tag in store.** The phone reads the barcode and downloads that garment's size specs (fabric, fit type, stretch, measurements per size).
3. **Instant fit diagnosis, on the phone, standing and sitting.** A 🪑 sitting check covers jeans, trousers, shirts, blazers, kurtas and dresses. It warns when a size fits standing but digs in, pulls at the buttons or rides up when you sit (measured from the sitting photo, otherwise estimated).
   **Fit engine details:** The fit engine (rules + math, not an LLM) compares body vs garment with ease and stretch, for example: *"Size M will be about 2.0 in tight at the hip. Grab size L instead."*
4. **Agentic AI acts on it.** The Snug agent (Gemini + Google ADK) receives only the fit verdicts, never measurements. It checks stock, finds alternatives that fit, holds a trial room and messages staff. If something goes wrong after the try-on, it recovers on its own.
5. **18 demo stores in 8 metro cities:** Bengaluru, Mumbai, Delhi NCR, Chennai, Hyderabad, Kolkata, Pune and Ahmedabad, each with its own stock, trial rooms and nearby stores. Shoppers pick their store from a city-grouped list or tap **📍 Use my location**, which finds the nearest store on the phone; the location is never sent. Edit `data/stores.json` to add more.
6. **Profiles for several people on one phone:** save a Fit Passport for yourself, family and friends (scan, estimate, enter manually, or from the kiosk with a name), switch with one tap, and see **Sizes for everyone** when you scan a tag. Profiles stay on the phone; the agent gets only the person's first name with the verdicts.
5b. **Mirror Tap trial-room QR / NFC.** Scanning the room placard tells Snug your store and room, so the agent sends sizes straight there.
6. **Store-floor Fit Kiosk** (concept option 3). A shopper scans fully clothed on a store tablet, and a QR moves the Fit Passport to their phone inside the URL fragment, which is never sent to any server. The kiosk wipes itself after 90 s.
7. **Speak your language.** Voice input and replies in English, Hindi, Kannada, Tamil, Telugu, Marathi or Bengali, with optional read-aloud.
8. **No-scan option.** "Tell Snug what you wear" estimates measurements from sizes you own. There's also a **tape accuracy check** for the scan.
9. **Complete the look.** The agent suggests a matching piece that also fits and is in stock.
10. **Insights Agent for managers.** "Which styles run small?" is answered from anonymous try-on feedback, alongside live **impact counters** (wrong-size try-ons avoided, trips saved).
11. **Installable app (PWA)** with a live camera guide for the body scan.
12. **Catalogue Agent.** It turns any brand's size-chart photo or PDF into validated garment data, with human review for anything suspicious.

> Math decides your size. AI measures you on the phone and acts for you in the store.

## Pages

| URL | What it is |
|---|---|
| `/app/` | Shopper app (mobile): Fit Passport, Scan tag, Ask Snug |
| `/app/tags.html` | Printable demo price tags with real EAN-13 barcodes |
| `/app/staff.html` | Store staff screen: live trial-room requests + today's impact |
| `/app/manager.html` | Store manager: impact counters, fit signals by style, Insights Agent chat |
| `/app/kiosk.html` | Store-floor **Fit Kiosk** (concept option 3): camera scan on a store tablet/laptop, then the passport is handed to the shopper's phone by QR |
| `/app/placards.html` | Printable "Mirror Tap" trial-room QR placards (also usable as NFC links) |
| `/app/catalogue.html` | Catalogue Agent: upload a size chart |
| `/dev-ui/` | ADK developer UI (debugging, backup demo) |

## What's in this repo

```
agent/
├── main.py                 # one server: ADK agent API + store API + web app
├── apps/
│   ├── snug_agent/         # Snug agent (acts on fit verdicts) + 8 tools
│   └── catalogue_agent/    # Catalogue Agent: size-chart image/PDF -> validated data
├── snug_core/
│   ├── fit_engine.py       # rules + math (server copy, used for tests and fallback)
│   └── db.py               # data layer: local in-memory OR Firestore
├── web/
│   ├── js/measure.js       # MediaPipe Pose Landmarker on the phone (photos never uploaded)
│   ├── js/measure_core.js  # silhouette -> widths/depths -> ellipse circumference
│   ├── js/fit.js           # fit engine ON THE PHONE (identical rules to fit_engine.py)
│   ├── js/app.js           # shopper app
│   └── index.html, staff.html, catalogue.html, tags.html
├── data/                   # 20 fictional garments with barcodes, stores, demo profiles
├── scripts/                # make_catalogue.py, seed_firestore.py
├── tests/                  # fit engine tests (pytest)
└── Dockerfile, deploy.sh, requirements.txt, .env.example
```

## Architecture and privacy

```
 PHONE (browser)                                      CLOUD RUN "snug"
 ├─ MediaPipe body scan -> measurements (local only)
 ├─ barcode scan ── GET /api/garments/by-gtin ──────> garment specs (no body data in)
 ├─ fit engine -> verdicts ("L fits; M tight at hip")
 └─ Ask Snug ── verdicts only ── /run_sse ──────────> ADK agent + Gemini
                                                       tools -> Firestore: stock, holds, staff tasks
 STAFF SCREEN <──────────── /api/stores/{id}/tasks ── live requests from the agent
```

**Body measurements never leave the phone.** The agent sees only per-garment verdicts (best size, confidence, notes).

---

## 1. Run it on your laptop (about 10 minutes)

You need Python 3.11+, the Google Cloud CLI, and a Google Cloud project with billing and the Gemini API (`aiplatform.googleapis.com`) enabled. See the setup guide PDF, steps 2–5.

```bash
cd agent
python3 -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt

gcloud auth application-default login
gcloud auth application-default set-quota-project YOUR_PROJECT_ID

cp .env.example .env      # then edit: GOOGLE_CLOUD_PROJECT and SNUG_MODEL (copy the Flash model ID from Model Garden)
python main.py
```

Open **http://localhost:8080/app/** (shopper app), `/app/tags.html` (demo tags) and `/app/staff.html` (staff screen). `/dev-ui/` shows every tool call. Camera and barcode scanning need HTTPS or localhost; Cloud Shell Web Preview and Cloud Run are both HTTPS.

`SNUG_BACKEND=local` (the default) keeps all data in memory, with no database setup. Restarting resets holds and tasks, which is handy for demos.

Run the fit engine tests:

```bash
pip install pytest && pytest -q
```

## 2. Use Firestore (optional, recommended for the final demo)

```bash
gcloud services enable firestore.googleapis.com
gcloud firestore databases create --location=asia-south1
python scripts/seed_firestore.py --project YOUR_PROJECT_ID
# in .env:  SNUG_BACKEND=firestore
```

## 3. Deploy to Cloud Run

One-time setup:

```bash
PROJECT=YOUR_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com aiplatform.googleapis.com firestore.googleapis.com
gcloud iam service-accounts create snug-agent-sa --display-name="Snug agent" --project $PROJECT
for ROLE in roles/aiplatform.user roles/datastore.user roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding $PROJECT \
    --member="serviceAccount:snug-agent-sa@$PROJECT.iam.gserviceaccount.com" --role=$ROLE
done
```

Deploy (from `agent/`):

```bash
./deploy.sh $PROJECT YOUR_FLASH_MODEL_ID              # defaults: asia-south1, firestore backend
# or, without Firestore:  ./deploy.sh $PROJECT YOUR_FLASH_MODEL_ID asia-south1 local
```

The script prints your live URL (`https://snug-xxxx.a.run.app/app/`).

`--max-instances 1` is intentional: ADK sessions live in memory, so one instance keeps conversations consistent. Before judging, run:

```bash
gcloud run services update snug --region asia-south1 --min-instances 1
```

This avoids cold starts. Set it back to 0 afterwards.

---

## 4. Customise

| Want to change | Edit |
|---|---|
| Garments, prices, stock | `scripts/make_catalogue.py` then `python scripts/make_catalogue.py` (and re-seed Firestore) |
| Demo shoppers | `data/demo_profiles.json` |
| Stores and trial rooms | `data/stores.json` |
| Agent behaviour and tone | `INSTRUCTION` in `apps/snug_agent/agent.py` |
| Fit rules (ease, tolerances) | `snug_core/fit_engine.py` (run `pytest` after) |
| Look and feel | `web/styles.css`, `web/index.html` |

---

## 5. Demo script (3 minutes)

Setup: phone with `/app/`, laptop showing `/app/tags.html` and `/app/staff.html` side by side.

1. **Problem (20 s):** shoppers carry 2–3 sizes into the trial room, and size problems drive returns. Trial-room sensors are expensive and invasive.
2. **Fit Passport (30 s):** show the 2-photo scan (or tap *Demo: Ananya*). "Measured on the phone with MediaPipe, photos wiped, numbers stay on the phone."
3. **Scan the tag (30 s):** scan *Maroon Velvet Kurta, size M* on the tag sheet. The verdict reads: *"Size M will be about 2.0 in tight at the hip. Grab size L instead."* Show the fit bars and the size strip.
4. **Agent acts (60 s):** tap **Get size L for me**. Live steps appear: reading your scan, checking fit on your phone, checking stock (L: 2 here). Say "yes, hold it": a room is held and the **staff screen lights up**.
5. **Recovery (20 s):** scan the *Ivory Chikankari Kurta*, then say "it's too long on me". The agent finds the Petite variant that fits and is in stock.
6. **Catalogue Agent (20 s):** upload `sample_size_chart_with_error.png`. Gemini reads it and the validator catches the typo, so it goes to human review.

**Optional extras for the demo:**

- Open the app by scanning a **Room 4 placard** from `/app/placards.html`. The chip shows "Room 4" and the agent sends sizes there.
- Switch the language to **Hindi** and use the 🎤 mic, then tap **Complete the look**.
- On `/app/manager.html`, ask *"Which styles run small, and what should I restock?"* and point at the impact counters.

## 6. What's real vs demo (say this in the pitch)

- **Real:** on-device MediaPipe body measurement, barcode scanning, the on-device fit engine with ease and stretch, the Gemini agent with ADK and multi-step tool use, stock checks, trial-room holds, live staff tasks, size-chart extraction and validation, and Cloud Run/Firestore deployment.
- **Demo:** fictional brands and catalogue (barcodes use the in-store-only EAN prefix 20–29), demo shopper profiles, and a web staff screen. Body-scan accuracy is not yet calibrated against tape measurements; that's the first roadmap step.
- **Roadmap:** calibration study (100+ volunteers), retailer data partnerships, NFC "Mirror Tap" placards, a fit-tuning agent learning from try-on feedback, a retailer insights agent, and native apps.

## 7. Troubleshooting

| Problem | Fix |
|---|---|
| `404 model not found` | Set `SNUG_MODEL` to an exact ID from Model Garden; keep `GOOGLE_CLOUD_LOCATION=global` |
| `429 resource exhausted` | Wait a minute; use the global location; avoid rapid repeated demos |
| `Permission denied` on Gemini | Run `gcloud auth application-default login` again; check the project in `.env` |
| Cloud Run build permission error | Open the build log link; grant the missing role it names to the build service account |
| Agent forgets the chat | Sessions reset on redeploy or restart: click **New chat** |
| Staff screen empty | Make sure the store selected in the shopper panel is the same one |

Built for the hackathon by **Team Snug**.

## 7b. Sign in / sign up (Firebase Authentication)

The app has a **sign in / sign up** screen with **phone number (SMS OTP)** and **email + password**, plus **Continue as guest**. Evaluator links (`?demo=…`, room QR, kiosk QR) skip it automatically. The account stores only name and phone/email; measurements stay on the phone. Without `web/firebase-config.json`, the app runs in guest mode.

Setup (about 15 minutes):

1. In the [Firebase console](https://console.firebase.google.com), click **Add project** and choose your existing Google Cloud project `snug-hack-2026`.
2. Go to **Project settings → Your apps → Web (`</>`)** and register "Snug web". Copy the `firebaseConfig` values into `agent/web/firebase-config.json` (template: `firebase-config.example.json`).
3. Go to **Build → Authentication → Get started → Sign-in method** and enable **Email/Password** and **Phone**.
   - Phone sign-in needs billing enabled on the project (pay-as-you-go). Real SMS are charged after any free allowance; check current Firebase pricing.
   - Under **Phone → Phone numbers for testing**, add `+91 9999900001` with code `123456`. This test number never sends an SMS, so evaluators can use it.
4. Go to **Authentication → Settings → Authorized domains** and add your Cloud Run host, e.g. `snug-xxxx-el.a.run.app`.
5. Create the test email account: in the app, go to **Email → Create account** with `judge@snug.demo` / `SnugDemo#2026`, or use **Authentication → Users → Add user**.
6. Redeploy with `deploy.sh`. The evaluator guide already lists these test credentials.

## 8. Keeping the prototype live during evaluation

**Submit this link:** `https://<your-service>.run.app/` opens the **evaluator guide** (`/app/judges.html`), which has a system-status light, demo steps and test barcodes.

Built-in reliability:

| Risk | Protection |
|---|---|
| Cold starts / instance shut down | `--min-instances 1` (always one warm instance) |
| Conversation lost after a restart | The app creates a new session and retries automatically |
| Gemini busy (429) or temporarily down (5xx) | 4 automatic retries with backoff, then `SNUG_MODEL_FALLBACK`, then a friendly message |
| CDN outage for the body-scan model | `deploy.sh` bundles MediaPipe and the pose model into the container |
| Barcode/QR libraries | Bundled in `web/vendor/` (no CDN needed) |
| Bots or spam running up AI costs | Per-IP limit on AI calls (`SNUG_AI_PER_MIN`, default 20/min) plus a billing budget alert |
| Demo data getting messy | Local mode resets to a clean demo state on restart |

Runbook:

1. **Freeze** after your final deploy. Do not redeploy during evaluation unless something is broken.
2. **Check daily:** open `/api/status` and run one chat. Look at Cloud Run → snug → Logs for errors.
3. **Uptime alert (5 min, free):** Cloud console → Monitoring → Uptime checks → Create. Protocol HTTPS, host = your run.app host, path `/api/status`, check every 5 minutes, with an email alert to both teammates.
4. **If a deploy breaks something, roll back instantly:**
   ```bash
   gcloud run revisions list --service snug --region asia-south1
   gcloud run services update-traffic snug --region asia-south1 --to-revisions=PREVIOUS_REVISION=100
   ```
5. **Billing:** keep the project and billing account active until results are announced. Free trial credits last 90 days. Don't delete the project and don't stop `min-instances` until evaluation ends.
6. **Test a new version safely:** `gcloud run deploy ... --no-traffic --tag test` gives you a separate test URL, then move traffic only after it works.
