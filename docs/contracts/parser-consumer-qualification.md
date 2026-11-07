# Parser consumer qualification

Implementation status: UNVALIDATED. The differential helper, fixture and small corpus are authored and unrun. No parser dependency/runtime/grammar migration is qualified by this document.

The shared qualification owner compares exact original UTF-8 source, observed parser identities, parse/recovery status, nodes/spans, chunks, declarations, imports, exports, calls and embedded segment mappings. Every adapter declares each family, including unsupported empty projections; clean parse acceptance alone cannot establish consumer parity. Spans must use exact UTF-16 source boundaries and cannot split surrogate pairs. Exact embedded segments must preserve their original source slice.

Intentional differences require a named case/family, exact before/after hashes and a reason. Wildcard or stale waivers cannot hide later changed behavior. Corpus execution accepts explicitly supplied parser owners, retains their existing worker/patch/ABI/cancellation authority and disposes acquired parser resources on both success and failure. Source, row and retained-byte budgets are independent. It performs no installation, dependency resolution or native rebuild.

The source fixture `lang/contracts/parser-qualification-differential` authors lost-call, Unicode-span, segment-map, exact-waiver and disposal controls. The initial corpus contains JS/TS/TSX, malformed edits, import attributes, Vue prefixes and C/Rust/Swift syntax cases. Concrete old/new Babel-major and patched Tree-sitter runtime/grammar adapters, actual consumer extraction receipts and supported-host ABI/native measurements remain pending. Consequently #1153 is partial; #1156 and #1167 are unimplemented migration work, and this helper is not a substitute for those upgrades.
