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

`risk.analysisStatus` is an object containing `status`, `reason`, `caps`, `bytes`,
and `lines`. Exceeding `maxBytes` or `maxLines` produces `status: "capped"`
before allocating the line array or evaluating rules. Exceeding `maxNodes`,
`maxEdges`, `maxMs`, or the number of distinct `maxFlows` stops further analysis
and retains the bounded partial evidence already collected. `reason` names the
limit; whole-chunk byte/line reasons may be joined with `|`. A time cap can yield
different partial prefixes on different machines, so consumers must inspect status
before treating the result as complete.

Rules are evaluated per line, with case-insensitive matching by default. Configure
SafeRegex through `indexing.riskRules.regex` (`flags`, `engine`, `maxPatternLength`,
`maxInputLength`, `maxProgramSize`, `timeoutMs`). Invalid patterns produce bounded
diagnostics and are excluded. Regex input failures count as no-match. Sources,
sinks, and sanitizers retain the first evidence location per rule; flows retain the
first distinct source/sink/scope/via combination in source traversal order.
`scope`, `excludes`, `maxMatchesPerLine`, and `maxMatchesPerFile` are not supported
rule fields and should not be used to configure this engine.

## Index state export

Builds serialize the effective rule bundle into `index_state.json` as `riskRules` so validation
and debugging can confirm the exact rule set and limits used. Serialized rules store regex
sources as strings (compiled SafeRegex objects are not persisted).
The bundle also includes `diagnostics` with bounded `warnings`/`errors` for any patterns
that fail SafeRegex compilation (code, message, ruleId, ruleName, field, pattern, flags).

## Phase 3 notes
- Risk analysis now treats cap exceedance as an early-exit condition (no full-file scanning).
- SafeRegex evaluation is guarded; regex errors are treated as no-match.
- A lightweight prefilter is applied before regex evaluation to reduce scan overhead.
- See `docs/specs/analysis-schemas.md` for analysis policy defaults.

