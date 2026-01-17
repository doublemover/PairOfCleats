# Medium fixture

This fixture is generated on demand to avoid committing thousands of files.

- Generator: `tests/fixtures/medium/generate.js`
- Default output: `tests/.cache/fixtures/medium`
- Default size: 5,000 files (adjust with `--count`)

Example:

```bash
node tests/fixtures/medium/generate.js --out tests/.cache/fixtures/medium --count 8000
```

Fixture tests under `tests/indexing/fixtures/` will auto-generate this fixture when they detect `generate.js`.
