# Map artifact graph capability reads

The map catalog and artifact routes accept the explicit selectors `indexRoot`
and `capabilityId` together. These select a retained build and its validated
graph capability. The existing build backend resolves and verifies the locator;
only its callback's `capability.indexDir` seeds actual artifact reads. A failed
selector never falls back to current, search, vectors or SQLite.

Catalog/object reads hold the backend reader callback until the entire read
settles. A row iterator keeps that same callback active across its bounded
continuation pages, idle residency and original close. Cursors bind repository,
artifact, manifest generation and the exact graph selectors. They cannot reopen
a sibling capability. The existing eight-reader, 128-row and byte budgets stay
in force.

Graph iterators capture their original methods and retain failed cleanup through
the existing map resource owner. The backend receives an observation of every
original scene/cache/diagnostic dependency, including bounded causal wrappers;
it does not infer settlement from copied owner fields. An unclosed iterator or
unknown observation retains the backend reader lease. Reconcile the exact
iterator owner first, then the backend error's original `releaseGraphReader`.
Neither operation retries a build or changes a current pointer. Cleanup failure
keeps the browser terminal and preserves its original failure for inspection.

Responses and the actual workspace picker retain graph-only identity and
explicitly avoid an aggregate-health claim. The original artifact action
forwards its selected root/capability along with the manifest generation.
Map-only consumer/adapter/DOM controls are authored but unrun. Backend immutable
snapshot qualification, real browser streams, native descriptor behavior and
optional-backend failure acceptance remain separate.
