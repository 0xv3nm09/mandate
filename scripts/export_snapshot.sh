#!/usr/bin/env bash
# Regenerate the GitHub Pages read-only snapshot from a running backend.
# Usage: backend running on :8787 → bash scripts/export_snapshot.sh → commit web/public/demo/mandate-snapshot.json
set -e
curl -sf localhost:8787/api/snapshot > "$(dirname "$0")/../web/public/demo/mandate-snapshot.json"
echo "snapshot exported: web/public/demo/mandate-snapshot.json"
