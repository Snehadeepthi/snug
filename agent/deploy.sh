#!/usr/bin/env bash
# Deploy Snug to Cloud Run (always-on for evaluation).
# Usage: bash deploy.sh PROJECT_ID MODEL_ID [REGION] [BACKEND] [FALLBACK_MODEL_ID]
set -euo pipefail
PROJECT=${1:?project id}; MODEL=${2:?gemini flash model id}
REGION=${3:-asia-south1}; BACKEND=${4:-local}; FALLBACK=${5:-gemini-3.5-flash}
SA="snug-agent-sa@${PROJECT}.iam.gserviceaccount.com"

# Bundle MediaPipe locally so the body scan never depends on a CDN (skips if already present).
bash scripts/fetch_mediapipe.sh || echo "WARNING: could not bundle MediaPipe; the app will load it from the CDN."

gcloud run deploy snug \
  --project "$PROJECT" --region "$REGION" --source . \
  --service-account "$SA" \
  --set-env-vars "GOOGLE_GENAI_USE_VERTEXAI=TRUE,GOOGLE_CLOUD_PROJECT=${PROJECT},GOOGLE_CLOUD_LOCATION=global,SNUG_MODEL=${MODEL},SNUG_MODEL_FALLBACK=${FALLBACK},SNUG_BACKEND=${BACKEND},SNUG_DEV_UI=1" \
  --allow-unauthenticated \
  --min-instances 1 --max-instances 1 --concurrency 80 \
  --cpu 1 --memory 1Gi --timeout 300

URL=$(gcloud run services describe snug --project "$PROJECT" --region "$REGION" --format='value(status.url)')
echo "Live at: ${URL}/app/   ·   Evaluator guide: ${URL}/app/judges.html"
curl -fsS "${URL}/api/status" && echo
