#!/usr/bin/env bash
# Downloads MediaPipe (WASM + pose model) into web/vendor/mediapipe so the body scan does not depend
# on external CDNs during evaluation. Safe to re-run. Run from the agent/ folder.
set -euo pipefail
DEST=web/vendor/mediapipe
mkdir -p "$DEST/wasm"
if [ ! -f "$DEST/vision_bundle.mjs" ]; then
  TMP=$(mktemp -d); (cd "$TMP" && npm pack --silent @mediapipe/tasks-vision@1.1.1 >/dev/null && tar xzf mediapipe-tasks-vision-1.1.1.tgz)
  cp "$TMP/package/vision_bundle.mjs" "$DEST/"
  cp "$TMP"/package/wasm/vision_wasm_internal.* "$TMP"/package/wasm/vision_wasm_nosimd_internal.* "$DEST/wasm/"
  rm -rf "$TMP"
fi
if [ ! -f "$DEST/pose_landmarker_full.task" ]; then
  curl -fsSL -o "$DEST/pose_landmarker_full.task" \
    https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task
fi
ls -la "$DEST" "$DEST/wasm"
echo "MediaPipe bundled locally."
