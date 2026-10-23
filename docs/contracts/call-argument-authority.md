# Source-qualified argument positions

Call details retain `args` as the existing five 80-character display previews.
The independent version-1 `arguments` receipt records parser language, original
syntactic argument count, exact runtime count or justified bounds, and up to 32
compact source slots. Each slot has operand/expansion/runtime ordinals, its
half-open UTF-16 range, raw bounded preview and completeness, and scalar kind.
All original counts remain independent of retained display and slot caps.

Ordinary operands retain exact positions until an unknown spread. Later operands
still contribute to the minimum count but cannot receive a fixed runtime ordinal.
Small direct array literals without nested spreads retain their source expansion
(including holes) under ordinary array iteration semantics. Variable/iterable
expansion stays unknown. These are static source facts, not observed execution.
The shared position owner also handles compiler timer payloads; activation/order
and effects remain separately unobserved. No timer is executed for qualification.

JavaScript now shares the bounded callable-node projector with TypeScript.
Receivers, patterns, defaults, rest, original formal counts and omitted slots are
explicit; 17th parameters no longer disappear behind the old 16-name preview.
Type and risk consumers join only known runtime positions to actual identifier
formals. Rest binds an array. A binding pattern does not flatten into positional
names. Qualified positives remain useful; missing tails, long previews and unknown
spreads retain incomplete risk frontiers rather than examined-untainted claims.

Canonical call-site JSONL retains the argument receipt separately from any
trimmed display fields and the existing generation-pinned semantic reference.
Rust/C++ explicit argument-list nodes distinguish empty and nonempty calls;
other unsupported grammar roles retain unavailable arguments. No arguments are
synthesized from callee spelling or reparsed from current worktree files. Full
semantic operands and retained-source admission remain with their existing owner.
A compact 300-argument call can have exact arity while only 32 slots are retained;
unretained type/risk facts remain incomplete, without duplicating the semantic
operand store or enabling semantic retention implicitly.

API report 1.2.0 includes argument qualification per observed call. Exact counts
or disjoint justified bounds can establish a mismatch; absent historical display
metadata cannot establish zero. Bounded/unavailable counts emit an actionable
qualification warning, preserving fail-on-warning policy and exact target joins.
Legacy report/artifact reads remain supported, with no invented source authority.

Meaning changes bump RecordsProducer 6, SourceChunking 21, TypeNormalization 11,
CallFlow 47, RiskPropagation 5 and BoundaryFlow 12. SyntaxCallFacts is 4.
Authored actual JS/TS/native parser, writer/reload/report, cross-file replay,
risk-frontier and compiler timer fixtures are unrun at the implementation commit;
Windows validation follows that commit.
