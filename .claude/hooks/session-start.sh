#!/bin/bash
# Claude Code on the web only: prepare headless Blender (bpy) for tools/blender/build_guest_suite.py.
# Never blocks the session: if the install fails, it says so and the session carries on.
set -uo pipefail
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi
"$CLAUDE_PROJECT_DIR/tools/blender/setup-cloud.sh" \
  || echo "blender setup failed; run tools/blender/setup-cloud.sh by hand to see why"
exit 0
