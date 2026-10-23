# Retained graph preview admission

`report map --serve --graph-capability <id> --index-root <retained-build>` uses
the same canonical report child as ordinary live previews. Code mode and an
explicit retained build are required; saved `--input` cannot ambiguously become
a live capability selection. The report backend owns
`withBuildGraphCapability` through the actual immutable map read, rendering and
publication. Preview admission does not open a redundant graph reader lease.

The preview forwards the exact root/id and requires a completed HTML publication.
It reopens that committed output through the existing saved-map descriptor
owner, verifies its original bytes and compares repository, manifest, producer,
options and selected consumer directory with the child receipt. Graph capability
id, build, retained source root and immutable root must agree in the receipt and
embedded payload. The immutable `indexDir` remains the actual consumer directory;
an unrelated current generation or source-build directory cannot replace it.

Ready identity is `retained-graph-capability-export`, which says nothing about
aggregate index/search/optional-backend health. Partial output, DOT fallback,
cancelled child work, mismatched payload or unconfirmed output descriptor cleanup
cannot become a ready preview. These admission checks supplement the backend's
capability validator; copied receipt fields do not grant backend read authority.

Inert child-boundary controls use the actual preview preparation consumer and are
authored but unrun. Canonical command, backend immutable snapshot, process drain,
loopback listener and browser/native acceptance remain deferred.
