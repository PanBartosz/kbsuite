#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="kognilabovh"                  # adjust if needed (e.g., user@kognilabovh)
REMOTE_PATH="/var/lib/docker/volumes/kb_suite_data/_data"
LOCAL_PATH="$(pwd)/data"

mkdir -p "$LOCAL_PATH"

# Use sudo on the remote side to access the docker volume path
RSYNC_OPTS=(-av --delete --rsync-path="sudo rsync")

echo "Copying $REMOTE_HOST:$REMOTE_PATH → local data (via sudo rsync)"
rsync "${RSYNC_OPTS[@]}" \
  "$REMOTE_HOST":"$REMOTE_PATH"/ \
  "$LOCAL_PATH"/
echo "Done."
