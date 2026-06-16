#!/usr/bin/env bash
set -uo pipefail

# Net-diff upstream sync. Required env: UPSTREAM_OWNER, UPSTREAM_REPO, TO_TAG,
# BASE_BRANCH. Optional: FROM_TAG (default: the release tag just before TO_TAG).
: "${UPSTREAM_OWNER:?}" "${UPSTREAM_REPO:?}" "${TO_TAG:?}" "${BASE_BRANCH:?}"
FROM_TAG="${FROM_TAG:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"

summary () { echo "$@" >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"; }

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git remote add upstream "https://github.com/${UPSTREAM_OWNER}/${UPSTREAM_REPO}.git" 2>/dev/null || true

if [ -z "$FROM_TAG" ]; then
  FROM_TAG=$(git ls-remote --tags --refs upstream 'v*' \
    | awk -F/ '{print $NF}' \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
    | sort -V \
    | awk -v to="$TO_TAG" '$0==to{print prev} {prev=$0}')
  [ -n "$FROM_TAG" ] || { echo "No tag before $TO_TAG; pass FROM_TAG."; exit 1; }
fi
echo "Sync range: $FROM_TAG -> $TO_TAG"

# Our local tags (step-security releases) differ from upstream's same-named
# tags, so fetch upstream's into a private namespace to avoid clobbering.
git fetch upstream \
  "refs/tags/${FROM_TAG}:refs/upstream/${FROM_TAG}" \
  "refs/tags/${TO_TAG}:refs/upstream/${TO_TAG}"

BRANCH="auto-cherry-pick-${TO_TAG}"
git switch -c "$BRANCH"

# Cumulative diff. Excludes = generated (dist), deps (dependabot owns), and
# fork-owned (.github, README).
git diff -M "refs/upstream/${FROM_TAG}" "refs/upstream/${TO_TAG}" -- . \
  ':(exclude)dist' ':(exclude)wrapper/dist' \
  ':(exclude)package.json' ':(exclude)package-lock.json' \
  ':(exclude)yarn.lock' ':(exclude)pnpm-lock.yaml' \
  ':(exclude).gitignore' ':(exclude).github' ':(exclude)README.md' \
  > /tmp/upstream.patch

summary "### Sync \`${FROM_TAG}\` -> \`${TO_TAG}\` ($(wc -l < /tmp/upstream.patch) patch lines)"
if [ ! -s /tmp/upstream.patch ]; then
  echo "No applicable source changes."
  exit 0
fi

git apply --3way --whitespace=nowarn /tmp/upstream.patch || true

# Re-apply the fork copyright-header overlay before judging conflicts, so the
# header never counts as one.
find index.js lib wrapper -type f -name '*.js' -not -path '*/dist/*' -print0 \
  | xargs -0 node "${HERE}/normalize-fork-overlay.mjs"

CONFLICTS=false
if grep -rln --exclude-dir=.git --exclude-dir=node_modules -e '^<<<<<<< ' . >/dev/null 2>&1; then
  CONFLICTS=true
  summary "⚠️ Genuine conflicts (manual resolution needed):"
  grep -rln --exclude-dir=.git --exclude-dir=node_modules -e '^<<<<<<< ' . \
    | sed 's/^/- /' | tee -a "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
else
  summary "✅ Applied cleanly (overlay normalized)."
  npm ci
  npm run build
  npm test
fi

git add -A
if git diff --cached --quiet; then
  echo "Nothing to commit."
  exit 0
fi

if [ "$CONFLICTS" = true ]; then
  COMMIT_MSG="chore: cherry-pick ${TO_TAG} from upstream [CONFLICTS - needs manual resolution]"
  PR_TITLE="chore: cherry-pick ${TO_TAG} from upstream [CONFLICTS]"
  PR_BODY=$(printf 'Automated net-diff sync from upstream `%s` -> `%s`.\n\n⚠️ Contains unresolved conflict markers. Resolve them, then run `npm ci && npm run build && npm test` before merging.' "$FROM_TAG" "$TO_TAG")
  DRAFT=--draft
else
  COMMIT_MSG="chore: cherry-pick ${TO_TAG} from upstream"
  PR_TITLE="$COMMIT_MSG"
  PR_BODY=$(printf 'Automated net-diff sync from upstream `%s` -> `%s`.\n\nApplied cleanly; fork header overlay normalized, dist rebuilt, tests passed.' "$FROM_TAG" "$TO_TAG")
  DRAFT=
fi

git commit -q -m "$COMMIT_MSG"
git push --force origin "HEAD:${BRANCH}"

if gh pr view "$BRANCH" --json number >/dev/null 2>&1; then
  gh pr edit "$BRANCH" --title "$PR_TITLE" --body "$PR_BODY"
else
  gh pr create --head "$BRANCH" --base "$BASE_BRANCH" --title "$PR_TITLE" --body "$PR_BODY" $DRAFT
fi

[ "$CONFLICTS" = false ] || { echo "::error::Conflicts present; draft PR opened for manual resolution."; exit 1; }
