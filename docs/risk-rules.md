# Risk rules

PairOfCleats supports configurable risk rules for sources, sinks, and sanitizers. The engine
uses these rules to detect local flows, then correlates cross-file flows when enabled.

## Rule bundle format

Rules are configured under `indexing.riskRules` in `.pairofcleats.json`.

```json
{
  "indexing": {
    "riskRules": {
      "includeDefaults": true,
      "rulesPath": "config/risk-rules.json",
      "rules": {
        "sources": [],
        "sinks": [],
        "sanitizers": []
      }
    }
  }
}
```

Each rule entry supports:
- `id` (string, optional) - stable rule identifier
- `name` (string, required)
- `category` (string, optional)
- `severity` (string, optional; sinks only)
- `tags` (string array, optional)
- `confidence` (number, optional)
- `languages` (string array, optional)
- `patterns` (string array, required, regex source)
- `requires` (string, optional, regex source)

## Default coverage

The default bundle includes:
- HTTP/body/query/params sources (`req.body`, `req.query`, etc)
- environment/CLI/stdin sources
- command execution, eval, file write, SQL, XSS, deserialization sinks
- basic sanitizers (escape/parameterize helpers)

## Provenance

The risk metadata output includes:
- `ruleProvenance.defaults` - whether defaults were applied
- `ruleProvenance.sourcePath` - path to any external bundle

## Resource caps

Configure caps under `indexing.riskCaps`:

```json
{
  "indexing": {
    "riskCaps": {
      "maxBytes": 204800,
      "maxLines": 3000,
      "maxNodes": 15000,
      "maxEdges": 45000,
      "maxMs": 75,
      "maxFlows": 150
    }
  }
}
```

If caps are exceeded, the engine records `risk.analysisStatus = "capped"` and falls back to
heuristic rule matching.
