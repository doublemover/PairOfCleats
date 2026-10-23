# Compiler type-fact source anchors

Status: UNVALIDATED source and authored controls, 2026-10-22.

Checker-inferred type expressions have an existing source anchor at the
declaration name, or at the beginning of an unnamed callable. The latter now
retains the first complete Unicode scalar from the exact compiler source text.
An unparenthesized arrow beginning with an astral identifier previously retained
only its leading UTF-16 surrogate, which failed retained-source scalar checks
and could expose a split source excerpt.

Named declarations and declared type spans remain unchanged. Inferred anchors
are source locations for the compiler observation; they do not claim the
printer expression appears literally at that source range. Existing expression,
fact-byte and work budgets remain unchanged. Shared compiler-binding producer
identity must advance; root owns that version update.

The authored actual TypeScript checker -> fact emitter -> canonical partition
writer -> artifact store fixture covers astral, BMP and ASCII unparenthesized
arrows, named/declared controls, exact retained text and full scalar verification.
It has not run. Parser/compiler/native/runtime and full-build qualification,
language-law correctness of type printers and broader inferred-source mapping
remain open.
