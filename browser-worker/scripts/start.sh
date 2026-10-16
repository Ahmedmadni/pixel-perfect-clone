#!/bin/sh
set -eu
: "${BROWSER_WORKER_TOKEN:?BROWSER_WORKER_TOKEN must be set}"
: "${VNC_PASSWORD:?VNC_PASSWORD must be set}"

# VNC password is required even though ports are mapped to the host loopback.
x11vnc -storepasswd "$VNC_PASSWORD" /tmp/paw-vnc.pass >/dev/null
chmod 600 /tmp/paw-vnc.pass

# Docker restart preserves container /tmp, including abandoned Xvfb lock/socket
# files. A running X server must NEVER be overridden; only remove leftover
# files after verifying that this private container has no live display.
if xdpyinfo -display :99 >/dev/null 2>&1; then
  echo "Refusing to start a second Xvfb on live display :99" >&2
  exit 1
fi
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
Xvfb :99 -screen 0 1440x900x24 -ac -nolisten tcp &
tries=0
until xdpyinfo -display :99 >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -gt 30 ]; then echo "Xvfb failed to start" >&2; exit 1; fi
  sleep 0.3
done

# NO keyboard/mouse input at startup; worker owns the server-side handoff.
x11vnc -display :99 -rfbport 5900 -listen 127.0.0.1 \
  -rfbauth /tmp/paw-vnc.pass -forever -shared -viewonly \
  -noxdamage -bg -o /tmp/paw-x11vnc.log

# noVNC is visible only via localhost port mapping in Docker Compose.
websockify --web /usr/share/novnc 0.0.0.0:6080 127.0.0.1:5900 &
exec node src/server.mjs
