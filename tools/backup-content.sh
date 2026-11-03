#!/usr/bin/env bash
# Local backup before/after editing content through the CMS.
# Usage: bash tools/backup-content.sh
set -euo pipefail
cd "$(dirname "$0")/.."
stamp="$(date +%Y%m%d-%H%M%S)"
dest="backups/$stamp"
mkdir -p "$dest"
cp products.json softwares.json index.html .pages.yml "$dest"/
echo "Đã sao lưu vào $dest"
