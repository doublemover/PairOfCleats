# Structural Search

PairOfCleats ships a lightweight structural-search harness that can invoke
external engines and normalize their matches into a common JSON output. This is
best used for security/risk signals, metadata extraction, or targeted pattern
searches that are hard to express as text queries.

Supported engines
- `semgrep` (rule packs in YAML)
- `ast-grep` (tree-sitter based rules)
- `comby` (template matcher for non-AST languages)

CLI
```bash
node tools/analysis/structural-search.js --pack semgrep-security --repo /path/to/repo
node tools/analysis/structural-search.js --pack astgrep-js-safety --format json
node tools/analysis/structural-search.js --engine semgrep --rule rules/semgrep/security.yml
```

Indexing integration
- Write results to the repo cache at `structural/structural.jsonl` (or `.json`), then run `build_index.js`.
- Matches are attached to chunk metadata under `docmeta.structural`.
- Search filters can target these with `--struct-pack`, `--struct-rule`, and `--struct-tag`.

Output format (JSONL default)
```json
{
  "engine": "semgrep",
  "pack": "semgrep-security",
  "ruleId": "example.rule",
  "message": "Avoid eval() usage.",
  "severity": "WARNING",
  "tags": ["security"],
  "path": "src/example.js",
  "startLine": 12,
  "startCol": 5,
  "endLine": 12,
  "endCol": 9,
  "snippet": "eval(input)",
  "metadata": { "category": "security" }
}
```

Notes
- Rule packs are defined in `rules/registry.json`. See `docs/guides/rule-packs.md`.
- Engines must be installed separately. This tool does not auto-install.
- Output is best-effort and normalizes different engine formats into a shared
  shape for later ingestion or analysis.

