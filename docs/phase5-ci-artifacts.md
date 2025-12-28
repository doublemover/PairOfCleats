# Phase 5: CI Artifact Generation + Detection

## Goal
Allow CI pipelines to build indexes and publish artifacts that can be restored locally without rebuilding.

## Artifact Layout
```
ci-artifacts/
  manifest.json
  index-code/
  index-prose/
  index-sqlite/index-code.db
  index-sqlite/index-prose.db
```

## Manifest
```json
{
  "version": 3,
  "generatedAt": "2025-01-01T00:00:00.000Z",
  "repo": { "remote": "https://github.com/org/repo.git", "root": "/path" },
  "commit": "<sha>",
  "dirty": false,
  "artifacts": {
    "code": "index-code",
    "prose": "index-prose",
    "sqlite": {
      "code": "index-sqlite/index-code.db",
      "prose": "index-sqlite/index-prose.db"
    }
  }
}
```

## Scripts
- Build artifacts:
  - `node tools/ci-build-artifacts.js --out ci-artifacts`
  - Flags: `--skip-build`, `--skip-sqlite`, `--incremental`
- Restore artifacts:
  - `node tools/ci-restore-artifacts.js --from ci-artifacts`
  - Use `--force` to override commit mismatch.

## Bootstrap Behavior
`npm run bootstrap` checks for `ci-artifacts/manifest.json` and restores when present (unless `--skip-artifacts` is set).

## GitHub Actions (example)
```yaml
- name: Build indexes
  run: node tools/ci-build-artifacts.js --out ci-artifacts
- name: Upload artifacts
  uses: actions/upload-artifact@v4
  with:
    name: pairofcleats-indexes
    path: ci-artifacts
```

## GitLab CI (example)
```yaml
build_indexes:
  script:
    - node tools/ci-build-artifacts.js --out ci-artifacts
  artifacts:
    paths:
      - ci-artifacts
```
