# Parsed import identity

Decoded dependency values retain their exact spelling through collector entries,
registry admission, relation projection and the production import scan. Literal
provenance suppresses scanner quote, punctuation and whitespace cleanup; control
characters and the existing length bound remain subject to admission. Heuristic
scanner tokens retain their existing cleanup. This policy does not resolve URLs,
execute language expressions or imply that an imported file exists.

HTML uses parse5-decoded `script[src]` and `link[href]` values from its recovered
DOM. Comments, raw script text and unrelated attributes do not become imports.
Source occurrences retain the original attribute spelling and UTF-16 offsets
separately from the decoded specifier. An extraction receipt identifies the
parse5 version and this exact DOM attribute scope; it does not certify document
validity or arbitrary runtime HTML dependencies. Dropped invalid values degrade
reuse admission. Existing parser metadata continues through the registered
HTML adapter. The package version participates in import-scan identity.

R uses its bounded lexical call/argument owner for static dependency references.
Bare/quoted package names, named options and decoded source paths retain their
identities through the outer registry. Dynamic `character.only` inputs, member
lookalikes, foreign namespaces and call text inside strings remain excluded.
Literal projection preserves the collector's extraction evidence and budget
diagnostics; it never upgrades lexical evidence into complete parser evidence.
An unqualified R bundle requires a fresh scan rather than authoritative replay.

The shared import-resolution producer advances 18→19, invalidating earlier
derived scans whose identities may have collapsed. Config and template adapters
reuse the same provenance projection without changing their existing admission
policy. Qualified HTML bundles can replay exact values; legacy bundles without
qualified extraction receipts must refresh.

Coverage owners:

- `tests/indexing/imports/parsed-attribute-and-r-import-replay.test.js`: actual
  registry, prepared adapters, cold scan, canonical bundle read/write, warm scan,
  stale-cache refresh, literal identity, raw/decoded provenance and admission.
- `tests/lang/contracts/r-static-argument-ownership.test.js`: original R defects,
  supported argument forms, dynamic/lookalike exclusions, escapes and budgets,
  including exact outer-registry values.
- Existing config literal, template identity and HTML comment/raw-script
  fixtures remain intact. Execution status belongs to the implementation receipt;
  authored assertions alone are not accepted qualification.
