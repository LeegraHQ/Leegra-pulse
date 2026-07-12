#!/usr/bin/env bash
# Pushes the draft "Standard visit" questionnaire for all 8 clients to the
# live site. Safe to re-run once you've edited the questions below — each
# client's questionnaire keeps the same name, but re-running still creates a
# NEW questionnaire record unless you pass back the `id` from a previous
# response (see ONBOARDING_AND_DEPLOY.md's note on updating vs. re-creating).
#
# Usage:
#   SITE_URL=https://your-site.netlify.app ./scripts/seed-questionnaires.sh
set -euo pipefail

SITE_URL="${SITE_URL:?Set SITE_URL, e.g. SITE_URL=https://your-site.netlify.app ./scripts/seed-questionnaires.sh}"
SUPER_ADMIN_EMAIL="${SUPER_ADMIN_EMAIL:-chris@leegra.co.za}"

echo "Logging in as $SUPER_ADMIN_EMAIL..."
TOKEN=$(curl -s -X POST "$SITE_URL/api/auth-login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$SUPER_ADMIN_EMAIL\"}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')

if [ -z "$TOKEN" ]; then
  echo "Could not get a token — check SITE_URL and that $SUPER_ADMIN_EMAIL matches SUPER_ADMIN_EMAIL in netlify/functions/_data.js" >&2
  exit 1
fi
echo "Got token."

push() {
  local tenant_code="$1"
  local payload="$2"
  echo "Uploading questionnaire for $tenant_code..."
  curl -s -X POST "$SITE_URL/api/admin-questionnaire-import" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "$payload" | python3 -m json.tool
  echo
}

push "PH-201" '{
  "tenant_code":"PH-201","name":"Standard visit",
  "questions":[
    {"label":"Shelf photo capture","type":"boolean","required":true},
    {"label":"Units on shelf","type":"number"},
    {"label":"Shelf pricing correct?","type":"boolean","required":true},
    {"label":"Shelf condition","type":"choice","options":["Good","Fair","Poor"],"required":true}
  ]
}'

push "SIR-014" '{
  "tenant_code":"SIR-014","name":"Standard visit",
  "questions":[
    {"label":"Product freshness check","type":"boolean","required":true},
    {"label":"Units in stock","type":"number"},
    {"label":"Display matches planogram?","type":"boolean","required":true},
    {"label":"Display condition","type":"choice","options":["Good","Fair","Poor"]}
  ]
}'

push "CIV-088" '{
  "tenant_code":"CIV-088","name":"Standard visit",
  "questions":[
    {"label":"Merchandising photo","type":"boolean","required":true},
    {"label":"Units in stock","type":"number"},
    {"label":"Promotional display up?","type":"boolean","required":true},
    {"label":"Display condition","type":"choice","options":["Good","Fair","Poor"]}
  ]
}'

push "BEU-305" '{
  "tenant_code":"BEU-305","name":"Standard visit",
  "questions":[
    {"label":"Shelf photo capture","type":"boolean","required":true},
    {"label":"Demo unit functioning?","type":"boolean","required":true},
    {"label":"Units on shelf","type":"number"},
    {"label":"Shelf condition","type":"choice","options":["Good","Fair","Poor"]}
  ]
}'

push "BRG-118" '{
  "tenant_code":"BRG-118","name":"Standard visit",
  "questions":[
    {"label":"Tyre stock count","type":"number","required":true},
    {"label":"Pricing board up to date?","type":"boolean","required":true},
    {"label":"Promotional signage present?","type":"boolean"},
    {"label":"Signage condition","type":"choice","options":["Good","Fair","Poor"]}
  ]
}'

push "SUP-042" '{
  "tenant_code":"SUP-042","name":"Standard visit",
  "questions":[
    {"label":"Service bay clean & staffed?","type":"boolean","required":true},
    {"label":"Tyres in stock","type":"number"},
    {"label":"Branding signage present?","type":"boolean","required":true},
    {"label":"Store condition","type":"choice","options":["Good","Fair","Poor"]}
  ]
}'

push "HAT-009" '{
  "tenant_code":"HAT-009","name":"Standard visit",
  "questions":[
    {"label":"Showroom display checklist","type":"boolean","required":true},
    {"label":"Vehicles on floor","type":"number"},
    {"label":"Brochure stock available?","type":"boolean"},
    {"label":"Showroom condition","type":"choice","options":["Good","Fair","Poor"]}
  ]
}'

push "TWR-260" '{
  "tenant_code":"TWR-260","name":"Standard visit",
  "questions":[
    {"label":"Catalogue stock available?","type":"boolean","required":true},
    {"label":"Units in stock","type":"number"},
    {"label":"Branch signage present?","type":"boolean"},
    {"label":"Branch condition","type":"choice","options":["Good","Fair","Poor"]}
  ]
}'

echo "Done."
