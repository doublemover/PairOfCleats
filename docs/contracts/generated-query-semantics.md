# Generated benchmark query semantics version 2

The query generator builds literal, phrase, AND, OR and leaf-negation expressions
before serialization. Compound expressions are not passed through a literal
formatter. API OR and symbol/type/API/behavior exclusions therefore exercise
actual public Boolean operators. Strategies that intentionally emit a phrase
retain that shape, even when the phrase contains OR or hyphen text.

Leaves follow the actual grammar: a safe single term stays a term; whitespace,
parentheses, operator words and other syntax-sensitive literals use a supported
quote delimiter. Backslashes remain literal rather than invented escapes. If a
literal contains both quote delimiters, generation rejects it explicitly. The
generator records bounded rejection counts/samples and tries other strategies
under the existing attempt caps. Structural/parser mismatches are producer
errors, not skipped candidates. Negation is limited to literal leaves under the
public compound-negation contract.

Every newly admitted query passes the production parser with exact intended
operators, leaf kinds and contents. Rows retain intended/observed shape classes
and parsed operator/leaf counts. JSON workload version 2 also records shape
counts, requested/emitted count, completeness and rejections. Text output retains
the version and coverage summary in comments. Seed/intent weights and bounded
unique-query generation remain; changed strings intentionally identify the
corrected workload rather than replaying the old phrase-only meaning.

The query-input owner recognizes the declared version 2 workload and verifies
that its string list, row list and count/generation receipt agree. Its frozen
plan retains producer-declared completeness separately from input admission.
Importing that receipt does not independently certify generator intent, retrieval
quality, runtime success or representative workload coverage. Unknown metadata
objects remain invalid query lists.

Independent OR and exclusion eligibility witnesses use authored document tokens.
Literal controls, backslashes, alternate quotes, dotted names, signatures,
unsupported delimiters and production-parsed distributions supplement the
existing deterministic language-family/intent checks. No backend, index or model
is required for this contract coverage.
