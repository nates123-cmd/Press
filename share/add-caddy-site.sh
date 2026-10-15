#!/usr/bin/env bash
# Adds press.nsteph.com to the Beelink's Caddy (~/apps/proxy) and reloads it
# gracefully. Idempotent. Run from the Mac:
#   ssh nate@100.111.77.98 'bash -s' < share/add-caddy-site.sh
set -euo pipefail
cd ~/apps/proxy
if grep -q 'press.nsteph.com' Caddyfile; then
  echo "press.nsteph.com already in Caddyfile"
else
  cp Caddyfile "Caddyfile.bak-$(date +%Y%m%d-%H%M)"
  # Append in place (>>): the file is bind-mounted, a new inode would go unseen.
  cat >> Caddyfile <<'EOF'

press.nsteph.com {
	log {
		output file /var/log/caddy/press.log {
			roll_size 10MiB
			roll_keep 5
		}
		format json
	}

	# Link previews for Press share links (~/apps/press-share), reached over
	# media_default. Read-only: preview bots get Open Graph tags, people get
	# a 302 to the app on GitHub Pages.
	reverse_proxy press-share:8080 {
		header_up X-Real-IP {remote_host}
	}
}
EOF
fi
docker exec caddy caddy validate --config /etc/caddy/Caddyfile
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
echo "reloaded; waiting for the certificate..."
for i in $(seq 1 24); do
  if curl -s -o /dev/null -w '%{http_code}' --resolve press.nsteph.com:443:192.168.4.21 \
       -A Twitterbot https://press.nsteph.com/s/check 2>/dev/null | grep -qE '200|302'; then
    echo "press.nsteph.com is up"; exit 0
  fi
  sleep 5
done
echo "no certificate yet; check: docker logs --since 5m caddy | grep -i press"
