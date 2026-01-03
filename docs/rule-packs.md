# Rule Packs

Rule packs define collections of structural-search rules plus metadata used to
tag and prioritize findings. Packs are registered in `rules/registry.json` and
reference rule files stored under `rules/`.

Registry schema
```json
{
  "packs": [
    {
      "id": "semgrep-security",
      "label": "Semgrep security starter pack",
      "engine": "semgrep",
      "rules": ["rules/semgrep/security.yml"],
      "severity": "medium",
      "tags": ["security", "baseline"],
      "description": "Basic security-oriented rules for common code patterns."
    }
  ]
}
```

Rule file formats
- Semgrep: YAML config files (one or more per pack).
- ast-grep: YAML rule files (one or more per pack).
- Comby: JSON files with `pattern`, `language`, and optional `message`.

Usage
```bash
node tools/structural-search.js --pack semgrep-security
node tools/structural-search.js --pack comby-docs --format json
```

Best practices
- Keep packs small and focused so results map cleanly to risk signals.
- Use consistent tags to group findings (e.g., `security`, `dataflow`, `audit`).
- Add new packs rather than editing existing ones if semantics differ.
