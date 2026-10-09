#!/bin/bash
# Install or update the Mac poller. Safe to rerun.
#
#   poller/install.sh            copy script + plist, (re)load the agent
#   poller/install.sh --build    also compile chatdb-dump (ONLY when the C changed:
#                                a rebuild changes the signature and Full Disk
#                                Access has to be granted again)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/Library/Application Support/press-poller"
PLIST="$HOME/Library/LaunchAgents/com.nate.press-poller.plist"
LABEL="com.nate.press-poller"

mkdir -p "$APP" "$HOME/.local/state/press-poller"
chmod 700 "$APP"

BUNDLE="$APP/Press Poller.app"
if [[ "${1:-}" == "--build" || ! -x "$BUNDLE/Contents/MacOS/chatdb-dump" ]]; then
  echo "compiling chatdb-dump and wrapping it as Press Poller.app (grant the app Full Disk Access afterwards)"
  cc -O2 -Wall -o "$APP/chatdb-dump" "$HERE/chatdb-dump.c" -lsqlite3
  # An app bundle, because System Settings on macOS 26 would not reliably add a
  # bare executable to Full Disk Access. The ad-hoc signature's identity changes
  # on every rebuild, which is why --build is opt-in.
  mkdir -p "$BUNDLE/Contents/MacOS"
  cp "$APP/chatdb-dump" "$BUNDLE/Contents/MacOS/chatdb-dump"
  cp "$HERE/Info.plist" "$BUNDLE/Contents/Info.plist"
  codesign --force --deep -s - -i com.nate.press-poller "$BUNDLE"
fi

cp "$HERE/press_poller.py" "$APP/press_poller.py"
if [[ ! -f "$APP/.env" ]]; then
  cat > "$APP/.env" <<'EOF'
SUPABASE_URL=https://jmpdqbabqrxkvwvxjzpu.supabase.co
SUPABASE_SERVICE_KEY=
PRESS_CHAT_ROWID=3184
EOF
  chmod 600 "$APP/.env"
  echo "fill in SUPABASE_SERVICE_KEY in $APP/.env"
fi

cp "$HERE/com.nate.press-poller.plist" "$PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "loaded $LABEL; log: ~/.local/state/press-poller/poller.log"

# The NYT reader: real Chrome, every 5 minutes, from the checkout.
NYT_PLIST="$HOME/Library/LaunchAgents/com.nate.press-nyt.plist"
cp "$HERE/com.nate.press-nyt.plist" "$NYT_PLIST"
launchctl bootout "gui/$(id -u)/com.nate.press-nyt" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$NYT_PLIST"
echo "loaded com.nate.press-nyt; log: ~/.local/state/press-poller/nyt.log"
echo
echo "If the log says 'authorization denied': System Settings > Privacy & Security >"
echo "Full Disk Access, then drag this app onto the list (or + and pick it):"
echo "  $BUNDLE"
