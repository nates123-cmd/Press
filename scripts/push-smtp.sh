#!/bin/bash
# Ask for the Brevo SMTP login and key, then push the auth config (SMTP,
# rate limit, site url, code-only email templates) to the Press project.
# Nothing is written to disk; the values live only in this shell's env for
# the one command. Run from the repo root:  bash scripts/push-smtp.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Brevo > SMTP & API > SMTP tab."
read -r -p "SMTP login (the one that looks like an email): " BREVO_SMTP_LOGIN
read -r -s -p "SMTP key (hidden as you type): " BREVO_SMTP_KEY
echo
if [[ -z "$BREVO_SMTP_LOGIN" || -z "$BREVO_SMTP_KEY" ]]; then echo "need both"; exit 1; fi
if [[ "$BREVO_SMTP_KEY" == xkeysib-* ]]; then echo "that is the API key, not the SMTP key"; exit 1; fi

export BREVO_SMTP_LOGIN BREVO_SMTP_KEY
supabase config push --yes
echo
echo "Done. Sign-in codes now go out through Brevo."
