#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="kognilabovh"                  # adjust if needed (e.g., user@kognilabovh)
REMOTE_PATH="/var/lib/docker/volumes/kb_suite_data/_data"
LOCAL_PATH="$(pwd)/data"

if [[ ! -d "$LOCAL_PATH" ]]; then
  echo "Local data dir not found: $LOCAL_PATH" >&2
  exit 1
fi

# Use sudo on the remote side to access the docker volume path
RSYNC_OPTS=(-av --delete --rsync-path="sudo rsync")

echo "Copying local data → $REMOTE_HOST:$REMOTE_PATH (via sudo rsync)"
rsync "${RSYNC_OPTS[@]}" \
  "$LOCAL_PATH"/ \
  "$REMOTE_HOST":"$REMOTE_PATH"/
echo "Done."
