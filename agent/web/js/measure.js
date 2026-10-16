// On-device body scan with MediaPipe Pose Landmarker (Google AI Edge). Photos never leave the phone:
// they are decoded into a canvas, analysed, and the pixels are wiped. Only numbers are kept.
// Prefers the copy bundled with the app (web/vendor/mediapipe, added by scripts/fetch_mediapipe.sh);
// falls back to Google's CDN/model storage if it is not bundled.
const CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1";
const CDN_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task";
const LOCAL = new URL("../vendor/mediapipe/", import.meta.url).href;
let landmarker = null;

async function loadVision() {
  try {
    const ok = await Promise.all(["vision_bundle.mjs", "pose_landmarker_full.task"].map((f) => fetch(LOCAL + f, { method: "HEAD" }).then((r) => r.ok)));
    if (ok.every(Boolean)) return { mod: await import(LOCAL + "vision_bundle.mjs"), wasm: LOCAL + "wasm", model: LOCAL + "pose_landmarker_full.task" };
  } catch {}
  return { mod: await import(CDN + "/vision_bundle.mjs"), wasm: CDN + "/wasm", model: CDN_MODEL };
}

async function getLandmarker(onStatus) {
  if (landmarker) return landmarker;
  onStatus?.("Loading the on-device body model (first time only)…");
  const { mod, wasm, model } = await loadVision();
  const { FilesetResolver, PoseLandmarker } = mod;
  const files = await FilesetResolver.forVisionTasks(wasm);
  const opts = (delegate) => ({ baseOptions: { modelAssetPath: model, delegate }, runningMode: "IMAGE",
                                numPoses: 1, outputSegmentationMasks: true });
  try { landmarker = await PoseLandmarker.createFromOptions(files, opts("GPU")); }
  catch { landmarker = await PoseLandmarker.createFromOptions(files, opts("CPU")); }
  return landmarker;
}

async function fileToCanvas(file, maxH = 1280) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, maxH / bmp.height);
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

function wipe(canvas) { const ctx = canvas.getContext("2d"); ctx.clearRect(0, 0, canvas.width, canvas.height); canvas.width = canvas.height = 0; }

async function analyse(file, lmk) {
  const canvas = await fileToCanvas(file);
  try {
    const res = lmk.detect(canvas);
    if (!res.landmarks?.length || !res.segmentationMasks?.length) throw new Error("No person found in the photo. Make sure your whole body is visible.");
    const m = res.segmentationMasks[0];
    const mask = { data: new Float32Array(m.getAsFloat32Array()), width: m.width, height: m.height };
    res.segmentationMasks.forEach((x) => x.close());
    return { landmarks: res.landmarks[0], mask };
  } finally { wipe(canvas); }
}

export async function measureBody({ heightCm, frontFile, sideFile, seatedFile, onStatus }) {
  const lmk = await getLandmarker(onStatus);
  onStatus?.("Finding your body outline (front)…");
  const front = await analyse(frontFile, lmk);
  let side = null;
  if (sideFile) { onStatus?.("Measuring depth (side)…"); try { side = await analyse(sideFile, lmk); } catch { side = null; } }
  let seated = null;
  if (seatedFile) { onStatus?.("Checking your sitting posture…"); try { seated = await analyse(seatedFile, lmk); } catch { seated = null; } }
  onStatus?.("Calculating measurements…");
  const result = window.SnugMeasureCore.computeMeasurements({ heightCm, front, side, seated });
  front.mask.data.fill(0); if (side) side.mask.data.fill(0); if (seated) seated.mask.data.fill(0);   // wipe silhouettes too
  return result;
}

window.SnugMeasure = { measureBody };
