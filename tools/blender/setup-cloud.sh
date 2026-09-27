#!/bin/bash
# Headless Blender for the guest-suite build in a cloud (Claude Code on the web) container.
#
# download.blender.org is not reachable there, so this uses the official `bpy` wheel from PyPI
# (Blender as a Python module) in a Python 3.11 venv, plus Mesa's software EGL/OpenGL so EEVEE can
# render on the CPU. Idempotent: re-running it only checks that everything is already in place.
#
#   tools/blender/setup-cloud.sh
#   tools/blender/blender-py tools/blender/build_guest_suite.py -- --out=/tmp/gs --only=room_level --res=25
set -euo pipefail

VENV="${BPY_VENV:-/opt/bpy-venv}"
BPY_VERSION="5.0.1"   # newest bpy on PyPI; the .blend was saved by Blender 5.2 and still loads

missing=()
for pkg in libegl1 libegl-mesa0 libgl1-mesa-dri; do
  dpkg -s "$pkg" >/dev/null 2>&1 || missing+=("$pkg")
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "blender setup: installing ${missing[*]}"
  apt-get update -qq >/dev/null 2>&1 || true   # unreachable PPAs only warn
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${missing[@]}" >/dev/null
fi

if ! "$VENV/bin/python" -c "import bpy, sys; sys.exit(bpy.app.version_string != '$BPY_VERSION')" >/dev/null 2>&1; then
  echo "blender setup: installing bpy $BPY_VERSION into $VENV"
  python3.11 -m venv "$VENV"
  "$VENV/bin/pip" install -q --disable-pip-version-check "bpy==$BPY_VERSION"
fi

echo "blender setup: bpy $BPY_VERSION ready ($VENV)"
