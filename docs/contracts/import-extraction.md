# Import extraction qualification

Import extraction and import resolution have separate outcomes. An empty import
array does not prove that a parser recognized an empty source surface, and zero
unresolved candidate edges does not prove successful extraction.

`collectLanguageImportResult` is the internal typed handoff: `{ entries,
receipt }`. Existing array callers retain the same receipt through a private
WeakMap, without retaining a parser tree or source text or parsing twice. Legacy
array producers are explicitly `unqualified`; missing capability is
`unsupported`. Malformed typed results and source/entry mismatches are contract
errors, not empty successes.

The version 1 receipt records:

- Producer and parser implementation identities, parser availability and the
  declared static reference scope. Successful config syntax remains `partial`.
- `complete`, `partial`, `unqualified`, `unsupported`, `unavailable`, `invalid`
  or `cancelled` state, independently of empty/nonempty/unknown recognition.
- An exact UTF-16LE JavaScript string hash and length when source acquisition
  succeeded. Unavailable source is null. `admittedLength` measures the supplied
  prefix; `scannedLength` stays null because these parsers do not measure a
  contiguous visited source extent.
- Collector limits and parser-owned structural limits where the parser exposes
  them; injected parsers without limit metadata retain null. Parser time caps
  are ceilings, not an assertion that synchronous operations are preemptible.
- Bounded reason counts, retained entries and observed parser entry count when
  available. Unknown producer omissions remain null.
- At most eight named normalization/projection steps with exact local input,
  retained, duplicate, invalid and omitted counts. Duplicate elimination is not
  resource loss. The simple-relation limit remains 512 distinct imports.
- A content identity binding the entire receipt and retained entries, including
  literal provenance and collector hints. This detects accidental rebinding;
  it is not a signature or a substitute for existing artifact/source authority.

`file_relations.importExtraction` binds the stored `imports` array.
`importScanExtraction` independently describes the import pass; that vector can
be larger than a capped file product. Artifact admission validates each envelope
and binds the file receipt to the actual stored array. Per-chunk relation data
does not duplicate either envelope.

Scan results and resolver admission retain failures even for files with no
specifier. No candidate edge or graph node is manufactured. Graph artifacts
carry `extractionCoverage` separately from resolver warning/taxonomy counts,
including file state totals, independent file-product states, recognized empty
counts, SQL usage qualification, bounded reasons and deterministic samples.
Reasons count affected files; omitted sample/reason observations are explicit.
Graph byte measurement includes this metadata. Warning suppression cannot erase
it. Import traversal, and SQL usage traversal when applicable, report incomplete
extraction through the existing fidelity warning path.

Incremental reuse requires the existing source/stat/fingerprint checks plus a
matching retained-array receipt, identified available parser and explicit reuse
policy. Successful static subsets can be reused with their original `partial`
qualification. Limits, invalid entries, unavailable/failed parsers, cancellation,
unknown parser identity and legacy arrays require refresh. A larger scan receipt
cannot qualify a shorter persisted file product. Import fingerprints include
the shared producer version, parser package versions, Node runtime and relevant
options; ordinary code parse dependencies include extraction runtime identity.
Package metadata is identity evidence, not parser activation or native readiness
qualification. Existing bootstrap and source-acquisition owners still apply.

Source read failures become file-level unavailable observations only for known
filesystem failures after confirming resource settlement. Pending ownership,
unreadable settlement reports and programming/contract errors continue to fail.

Regression owners are
`tests/indexing/language-registry/import-extraction-receipts.test.js` and
`tests/indexing/imports/import-extraction-handoff.test.js`, alongside the existing
registry budget, literal import identity and non-JS resolution fixtures. The
historical implementation receipt records execution status separately.
