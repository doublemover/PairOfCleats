# Lint enrichment evidence

Index linting uses an isolated built-in JavaScript policy on ESLint 10. It never
searches for repository configuration, loads repository plugins/processors or
honors inline policy directives. There is no new public configuration surface.
ESLint receives the absolute indexed root as `cwd` and a contained absolute file
path with the exact supplied whole-file source text. Process cwd is unchanged.

The declared policy covers JS/JSX/MJS/CJS with the built-in parser and these core
rules: `constructor-super`, `no-dupe-args`, `no-dupe-keys`,
`no-this-before-super`, `no-unreachable`, `no-unsafe-finally`, and `valid-typeof`.
CommonJS files select CommonJS parsing; JSX parsing is enabled. TypeScript and
other unsupported syntax receive explicit unsupported evidence. This policy is
an indexing diagnostic aid, not a repository's configured lint/release gate.

Each whole-file result carries a versioned receipt with status, reason, exact
source path/hash/UTF-8 size, effective policy/root identity, actual ESLint/Node/V8
producer, bounded failure diagnostics and aggregate message counts. Only a
completed run with zero messages is clean. Disabled, ignored, unsupported,
unavailable, failed and canceled outcomes are distinct. No result is treated as
clean merely because its projected message array is empty.

The legacy chunk `lint` array remains the interval-filtered message projection.
`docmeta.lintOutcome` retains the whole-file receipt independently of that array;
the immutable per-file bundle also retains it for files with no emitted chunks.
Projection admits at most 256 messages and 64 KiB, with 1,024 characters per
message and explicit omitted/truncated counts. It excludes fix and suggestion
payloads. Receipts do not assert full analysis beyond those bounds.

Cache keys bind source bytes and the same policy identity used by enrichment
dependency signatures and worker input. Policy-only changes invalidate enrichment
while parse and lexical dependencies remain independent. Bundle replay requires
matching whole-file/chunk evidence and current policy. Deterministic unsupported,
ignored and parser/heavy-file downshift receipts can replay with their explicit
negative status; missing policy, execution/init failures, unqualified empty
results, cancellation and truncated evidence cannot become reusable clean data.
The lint projection producer is version 3.

The runtime owner retains at most eight root/policy sessions. It evicts idle
entries only, refuses new sessions when all slots are active and discards failed
runtimes after their active operations settle. ESLint supplies no session close
API. Cancellation checks surround actual awaited operations; they do not race
outstanding lint work into early settlement or start a second policy fallback.
Original failures remain on the in-process result or cancellation cause graph;
persisted diagnostics are bounded data. Initialization can recover on a later
attempt. There is no process-global sticky failure latch.

Authored controls cover real ESLint root isolation and executable-config
sentinels, opposite safe core policies in both root orders, inline directives,
failure recovery, ignored/no-result, disabled/unsupported, cancellation ownership,
session capacity, source/policy cache invalidation, immutable receipt read-back
and nested interval projection. Functional execution is deferred in the current
implementation-first campaign; these are coverage definitions, not pass receipts.
