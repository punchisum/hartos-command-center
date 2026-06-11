#!/usr/bin/env bash
# scripts/apply-credentials.sh — apply the HARTOS credential backfill in one go.
#
# Usage:
#   bash scripts/apply-credentials.sh [credentials.backfill.env]
#
# What it does (skips anything left blank, confirms before each section):
#   1. Generates wrangler.cockpit.toml from the example with the non-secret
#      vars filled in (URLs + fitness user/agent ids, APP_ENV=production).
#   2. Pushes the cockpit Worker secrets via `wrangler secret put`:
#      HARTOS_OPS_SUPABASE_READONLY_KEY, HARTOS_FITNESS_SUPABASE_READONLY_KEY,
#      HARTOS_COCKPIT_ACCESS_TOKEN (auto-generated if blank; printed ONCE).
#   3. Optionally redeploys the cockpit from this repo (so repo = deployed).
#   4. Optionally fixes the GECAN webhook fail-open: sets
#      TELEGRAM_WEBHOOK_SECRET on gecan-ops-ai-webhook and re-registers the
#      Telegram webhook with that secret.
#   5. Optionally wires GitHub Actions staging-deploy secrets via `gh`.
#
# Requirements: wrangler authenticated (wrangler login, or CLOUDFLARE_API_TOKEN
# + CLOUDFLARE_ACCOUNT_ID exported). Section 5 needs the gh CLI.

set -euo pipefail
cd "$(dirname "$0")/.."

FILE="${1:-credentials.backfill.env}"
COCKPIT_TOML="wrangler.cockpit.toml"
COCKPIT_WORKER="hartos-command-center"
GECAN_WORKER="gecan-ops-ai-webhook"

if [[ ! -f "$FILE" ]]; then
  echo "✗ $FILE not found. Copy credentials.backfill.env.example, fill it, retry." >&2
  exit 1
fi
# shellcheck disable=SC1090
set -a; source "$FILE"; set +a

gen() { openssl rand -hex 32 2>/dev/null || head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
ask() { read -r -p "$1 [y/N] " a; [[ "$a" == "y" || "$a" == "Y" ]]; }
put_secret() { # put_secret NAME VALUE extra-wrangler-args...
  local name="$1" value="$2"; shift 2
  printf '%s' "$value" | npx wrangler secret put "$name" "$@"
  echo "  ✓ secret $name set"
}

echo "═══ HARTOS credential backfill ═══"

# ── 1+2. Cockpit Worker ──────────────────────────────────────────────────────
if ask "1) Configure + push cockpit Worker ($COCKPIT_WORKER) vars and secrets?"; then
  sed -e "s|^HARTOS_OPS_SUPABASE_URL = \"\"|HARTOS_OPS_SUPABASE_URL = \"${HARTOS_OPS_SUPABASE_URL:-}\"|" \
      -e "s|^HARTOS_FITNESS_SUPABASE_URL = \"\"|HARTOS_FITNESS_SUPABASE_URL = \"${HARTOS_FITNESS_SUPABASE_URL:-}\"|" \
      -e "s|^HARTOS_FITNESS_USER_ID = \"\"|HARTOS_FITNESS_USER_ID = \"${HARTOS_FITNESS_USER_ID:-}\"|" \
      -e "s|^HARTOS_FITNESS_AGENT_ID = \"\"|HARTOS_FITNESS_AGENT_ID = \"${HARTOS_FITNESS_AGENT_ID:-}\"|" \
      wrangler.cockpit.toml.example > "$COCKPIT_TOML"
  echo "  ✓ $COCKPIT_TOML generated (gitignored)"

  [[ -n "${HARTOS_OPS_SUPABASE_READONLY_KEY:-}" ]] && \
    put_secret HARTOS_OPS_SUPABASE_READONLY_KEY "$HARTOS_OPS_SUPABASE_READONLY_KEY" --config "$COCKPIT_TOML"
  [[ -n "${HARTOS_FITNESS_SUPABASE_READONLY_KEY:-}" ]] && \
    put_secret HARTOS_FITNESS_SUPABASE_READONLY_KEY "$HARTOS_FITNESS_SUPABASE_READONLY_KEY" --config "$COCKPIT_TOML"

  if [[ -z "${HARTOS_COCKPIT_ACCESS_TOKEN:-}" ]]; then
    HARTOS_COCKPIT_ACCESS_TOKEN="$(gen)"
    echo "  ── COCKPIT LOGIN TOKEN (save this — printed once) ──"
    echo "     $HARTOS_COCKPIT_ACCESS_TOKEN"
    echo "  ────────────────────────────────────────────────────"
  fi
  put_secret HARTOS_COCKPIT_ACCESS_TOKEN "$HARTOS_COCKPIT_ACCESS_TOKEN" --config "$COCKPIT_TOML"

  if ask "   Redeploy cockpit from this repo now (npm run build + wrangler deploy)?"; then
    npm run build
    npx wrangler deploy --config "$COCKPIT_TOML"
    echo "  ✓ cockpit deployed — vars + secrets live"
  else
    echo "  ⚠ vars in $COCKPIT_TOML take effect on the NEXT deploy."
  fi
fi

# ── 4. GECAN webhook fail-open fix ───────────────────────────────────────────
if ask "2) Fix GECAN webhook ($GECAN_WORKER) Telegram secret?"; then
  if [[ -z "${GECAN_TELEGRAM_WEBHOOK_SECRET:-}" ]]; then
    GECAN_TELEGRAM_WEBHOOK_SECRET="$(gen)"
    echo "  generated GECAN webhook secret"
  fi
  put_secret TELEGRAM_WEBHOOK_SECRET "$GECAN_TELEGRAM_WEBHOOK_SECRET" --name "$GECAN_WORKER"
  if [[ -n "${GECAN_TELEGRAM_BOT_TOKEN:-}" && -n "${GECAN_TELEGRAM_WEBHOOK_URL:-}" ]]; then
    curl -fsS "https://api.telegram.org/bot${GECAN_TELEGRAM_BOT_TOKEN}/setWebhook" \
      --data-urlencode "url=${GECAN_TELEGRAM_WEBHOOK_URL}" \
      --data-urlencode "secret_token=${GECAN_TELEGRAM_WEBHOOK_SECRET}" >/dev/null
    echo "  ✓ Telegram webhook re-registered with the new secret"
  else
    echo "  ⚠ GECAN_TELEGRAM_BOT_TOKEN/_WEBHOOK_URL blank — re-register the"
    echo "    Telegram webhook yourself with secret_token=<the new secret>,"
    echo "    or Telegram posts will start getting 403s."
  fi
fi

# ── 5. GitHub Actions staging deploy ─────────────────────────────────────────
if [[ "${SETUP_GITHUB_STAGING_DEPLOY:-false}" == "true" ]]; then
  if ask "3) Push staging-deploy secrets to GitHub Actions (gh CLI)?"; then
    for v in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY STAGING_SUPABASE_URL \
             TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET STAGING_TELEGRAM_WEBHOOK_URL \
             TRIGGER_SECRET_KEY CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID \
             CLOUDFLARE_WORKER_NAME STAGING_CLOUDFLARE_WORKER_URL; do
      if [[ -n "${!v:-}" ]]; then
        printf '%s' "${!v}" | gh secret set "$v"
        echo "  ✓ gh secret $v"
      fi
    done
    gh variable set ENABLE_STAGING_DEPLOY --body true
    echo "  ✓ ENABLE_STAGING_DEPLOY=true — merges to the default branch now deploy to staging"
  fi
fi

echo "═══ Done. Verify: curl -s https://<cockpit-url>/health ; then log in with the cockpit token. ═══"
