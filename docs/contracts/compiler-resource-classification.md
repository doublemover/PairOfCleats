# Compiler resource classification

Type-fact emission can retain declared evidence and report
`checker_type_failure` when a checker operation fails after its work has settled.
An original pending or unreadable resource observation instead aborts the
operation before the binding partition is published. The existing resource owner
retains recovery authority; compiler classification never retries its close,
reissues the checker operation or grants release proof.

Node boundary authority treats `ENOENT` and `ENOTDIR` package metadata failures as
missing authority only after the captured original observation confirms
settlement. It rechecks that same observation after inspecting the error code.
Replacing the diagnostic callback cannot release the captured work. An inspection
throw, including a falsey value or another pending resource, is retained with the
original failure through the existing storage compositor.

Successful compiler facts, boundary evidence and producer identities are
unchanged. This is a consumer failure guard; it does not establish ownership of
every TypeScript internal read or replace the current package reader. Synchronous
compiler-host throws still propagate directly. Independent async metadata read
failures retain their existing non-missing failure behavior.

`tests/indexing/semantic/compiler-resource-classification.test.js` authors controls
using an actual TypeScript Program/checker, an imported Node declaration and one
original contained-file descriptor whose close fails. It also covers ordinary
partial evidence, package metadata caching, missing metadata, falsey throws,
diagnostic callback replacement and unreadable observations. These controls are
UNVALIDATED until the deferred integration pass executes them.
