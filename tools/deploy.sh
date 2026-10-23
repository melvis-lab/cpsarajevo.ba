#!/usr/bin/env bash
# Deploy cpsarajevo.ba to Netlify from the committed git tree only.
#
#   tools/deploy.sh            deploy origin/main to production
#   tools/deploy.sh --draft    upload a draft deploy (preview URL) instead
#
# Why: deploys from an old working folder wiped /en/, /ar/ and Buffer media
# (21 and 23 Oct 2026). This script refuses to run unless the tree is clean
# and equal to origin/main, builds from `git archive HEAD` (never .git or
# untracked files), checks every file in social/MANIFEST.txt is present,
# and checks the live URLs after the deploy.
set -euo pipefail

SITE_ID="073ca5ce-5d3d-4b17-8435-3b727de10cbf"   # collection-premium-sarajevo
LIVE="https://cpsarajevo.ba"
NETLIFY_ADDR="https://collection-premium-sarajevo.netlify.app"
PROD="--prod"
[[ "${1:-}" == "--draft" ]] && PROD=""

cd "$(git rev-parse --show-toplevel)"

fail() { echo "STOP: $*" >&2; exit 1; }

command -v netlify >/dev/null || fail "Netlify CLI missing (npm i -g netlify-cli)"

# 1. Clean tree, up to date with origin/main
[[ -z "$(git status --porcelain)" ]] || { git status --short; fail "uncommitted changes. Commit or stash first."; }
git fetch -q origin main
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] \
  || fail "HEAD ($(git rev-parse --short HEAD)) is not origin/main ($(git rev-parse --short origin/main)). Run: git pull"

# 2. Generated pages must be current
if command -v python3 >/dev/null; then
  python3 tools/build_pages.py >/dev/null
  [[ -z "$(git status --porcelain)" ]] || { git status --short; git checkout -- .; fail "en/ or ar/ pages are out of date. Run python3 tools/build_pages.py and commit."; }
fi

# 3. Build folder from git only
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT
git archive HEAD | tar -x -C "$BUILD"

# 4. Manifest check
missing=0
while IFS= read -r f; do
  [[ -z "$f" || "$f" == \#* ]] && continue
  [[ -f "$BUILD/$f" ]] || { echo "missing: $f" >&2; missing=1; }
done < social/MANIFEST.txt
for f in index.html en/index.html ar/index.html prica/index.html robots.txt sitemap.xml; do
  [[ -f "$BUILD/$f" ]] || { echo "missing: $f" >&2; missing=1; }
done
[[ $missing == 0 ]] || fail "files missing from the build"

echo "Deploying $(git rev-parse --short HEAD) ($(find "$BUILD" -type f | wc -l | tr -d ' ') files, $(du -sh "$BUILD" | cut -f1))"
netlify deploy $PROD --site "$SITE_ID" --dir "$BUILD" \
  --message "$(git rev-parse --short HEAD) $(git log -1 --format=%s | cut -c1-60)"

[[ -z "$PROD" ]] && { echo "Draft deploy done. Not checking live URLs."; exit 0; }

# 5. Live checks
sleep 5
bad=0
check() { local c; c=$(curl -s -o /dev/null -w "%{http_code}" -L --max-time 30 "$1"); [[ "$c" == 200 ]] || { echo "  $c $1" >&2; bad=1; }; }
echo "Checking live URLs..."
for p in / /en/ /ar/ /prica/ /privatnost/ /racun/ /kreatori/ /sitemap.xml /robots.txt; do check "$LIVE$p"; done
while IFS= read -r f; do
  [[ -z "$f" || "$f" == \#* ]] && continue
  check "$LIVE/$f"; check "$NETLIFY_ADDR/$f"
done < social/MANIFEST.txt
[[ $bad == 0 ]] && echo "All live checks passed." || fail "some live URLs failed (listed above)"
