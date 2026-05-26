---
name: release-vscode-extension
description: 'Cut a new release of a VS Code extension: update CHANGELOG.md, bump version, build/test, tag, push, publish to Marketplace (with explicit user approval), and re-open an Unreleased section for the next cycle. Use when the user says "make a release", "cut a release", "release vX.Y.Z", "ship a release", or asks to publish after a feature/fix milestone. Composes with the publish-vscode-extension skill for the Marketplace step.'
---

# Release a VS Code Extension

End-to-end release workflow for a VS Code extension repo. This skill is composable: the Marketplace publish step calls into the `publish-vscode-extension` skill.

## When to Use
- User asks to "make/cut/ship a release" or "release vX.Y.Z"
- A logical milestone has landed and you want a tagged + published version
- DO NOT use for simple version bumps without an actual release intent

## Inputs to gather
Before starting, confirm (ask the user only if not obvious from context):
1. **Target version** — explicit (`0.2.0`) or implied (`patch` / `minor` / `major`). Infer from CHANGELOG content if unclear and propose it.
2. **Whether to publish to Marketplace** — default: ask. Pushing a git tag is reversible; a Marketplace publish is not.

## Procedure

### 1. Sanity checks (fail fast)
```fish
git status --short
git log --oneline (git describe --tags --abbrev=0 2>/dev/null; or echo HEAD~20)..HEAD
```
- Working tree must be clean (or only contain the release edits you're about to make).
- There must be real commits since the last tag. If none, stop and tell the user.

### 2. Update CHANGELOG.md
The CHANGELOG normally has an `## Unreleased` section accumulating notes. Convert it into the new version section.

- Read the current `## Unreleased` block.
- If it's empty or thin, scan `git log --oneline <last-tag>..HEAD` and draft entries grouped by:
  - Features
  - UI
  - Performance
  - Correctness / state / bug fixes
  - Security
  - Internal / refactor (only when user-visible or notable)
- Rename `## Unreleased` to `## X.Y.Z`. Keep prose tight; one bullet per change.
- Do NOT include a date unless the project's CHANGELOG already uses dates.

### 3. Bump version
Edit `package.json` `version` field to `X.Y.Z`. Then sync the lockfile:
```fish
npm install --package-lock-only
```
Verify the lockfile diff only touches the version (no dependency churn).

### 4. Verify the release is buildable
```fish
npm test
npm run package  # production build (check-types + lint + esbuild --production)
```
Both must pass. If they don't, stop and report.

### 5. Package the vsix locally
```fish
npx --yes @vscode/vsce package
```
Produces `<name>-X.Y.Z.vsix`. Quickly review the printed file list — it should NOT include `src/`, tests, `*.map`, `*.ts`, configs. Fix `.vscodeignore` if it does.

### 6. Commit + tag
```fish
git add CHANGELOG.md package.json package-lock.json
git commit -m "release: X.Y.Z"
git tag -a X.Y.Z -m "vX.Y.Z"
```
Tag style matches the project's existing tags — check `git tag --list` first. If the repo uses `vX.Y.Z`, prefix with `v`; otherwise use the bare number.

### 7. Push (confirm first if user hasn't pre-approved)
Pushing a tag is hard to undo cleanly. Ask once if intent isn't clear; otherwise:
```fish
git push origin <default-branch>
git push origin <tag>
```

### 8. Publish to Marketplace — REQUIRES USER APPROVAL
Marketplace publish is irreversible: a published version cannot be reused or silently replaced.

**Always ask explicitly** before publishing unless the user has already said something equivalent to "make a release and publish" or "ship X.Y.Z to marketplace". Sample question to use via `vscode_askQuestions`:

> "Publish ulugbekna.<name> X.Y.Z to the VS Code Marketplace now?"
> - Yes, publish now
> - No, leave the release local

If the user is unavailable / autonomous mode, DEFAULT TO NOT PUBLISHING — push the tag, but stop short of Marketplace publish and tell the user how to publish later.

When approved, follow the `publish-vscode-extension` skill:
```fish
set -x VSCE_PAT (az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv)
npx --yes @vscode/vsce verify-pat <publisher>
npx --yes @vscode/vsce publish --packagePath <name>-X.Y.Z.vsix
```
Verify the listing URL prints in vsce output.

### 9. Re-open an Unreleased section
After publishing (or after pushing the tag if Marketplace was skipped), add a fresh `## Unreleased` block at the top of CHANGELOG so the next feature commits have a place to go.

```markdown
# Change Log

## Unreleased

## X.Y.Z
...
```

Commit this as a small follow-up:
```fish
git add CHANGELOG.md
git commit -m "docs: re-open Unreleased section"
git push origin <default-branch>
```

## Outputs / final report
- The new tag name and commit SHA
- Whether the Marketplace publish ran (and if so, the listing URL)
- Path to the local `.vsix` (so user can `code --install-extension` to sanity-check before listing goes live)

## Anti-patterns
- Publishing without explicit user approval
- Bumping version without a CHANGELOG entry
- Re-publishing the same version (Marketplace will reject; pick the next number)
- Releasing on a dirty working tree (commit or stash first)
- Skipping `npm test` / `npm run package` before tagging
- Forgetting to re-open `## Unreleased` (next feature commits end up directly under the released section)

## Notes
- If the project's CHANGELOG predates this workflow and has no `Unreleased` section yet, create one as part of the release commit.
- Semver judgment: behavior changes / new features → minor; only bug fixes → patch; breaking config or message-protocol changes → major. When in doubt, ask.
