#!/usr/bin/env bash
# Shows the Firebase Auth settings that decide whether real SMS OTPs are sent. Run in Cloud Shell:
#   bash scripts/check_phone_auth.sh snug-hack-2026
# Add "fix" as a second argument to allow SMS to every country:  bash scripts/check_phone_auth.sh snug-hack-2026 fix
set -euo pipefail
PROJECT=${1:?project id}
TOKEN=$(gcloud auth print-access-token)
URL="https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config"
H=(-H "Authorization: Bearer ${TOKEN}" -H "x-goog-user-project: ${PROJECT}" -H "Content-Type: application/json")
if [ "${2:-}" = "fix" ]; then
  curl -s -X PATCH "${H[@]}" "${URL}?updateMask=smsRegionConfig" -d '{"smsRegionConfig":{"allowByDefault":{}}}' >/dev/null
  echo "SMS region policy set to: allow all regions."
fi
curl -s "${H[@]}" "${URL}" | python3 -c '
import sys, json
d = json.load(sys.stdin)
if "error" in d: print("ERROR:", d["error"].get("message")); sys.exit(1)
ph = d.get("signIn", {}).get("phoneNumber", {})
print("Phone sign-in enabled :", ph.get("enabled", False))
print("Test numbers          :", list((ph.get("testPhoneNumbers") or {}).keys()))
r = d.get("smsRegionConfig") or {}
if "allowlistOnly" in r:   print("SMS regions           : ONLY", r["allowlistOnly"].get("allowedRegions", []), "(India must be IN)")
elif "allowByDefault" in r: print("SMS regions           : all except", r["allowByDefault"].get("disallowedRegions", []))
else:                       print("SMS regions           : no policy (all allowed)")
print("Authorized domains    :", d.get("authorizedDomains", []))
print("Auth product          :", d.get("subtype", "?"))
print("SMS quota             :", json.dumps(d.get("quota", {})) or "default")
'
