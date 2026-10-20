# Spec: VFS hash routing (active contract)

Status: Active optional routing policy version 2.0.0.
Last audited: 2026-10-20.
Owners: `src/index/tooling/vfs/virtual-path.js`, `vfs/documents.js`,
`src/index/build/artifacts/writers/vfs-manifest.js`.

Hash routing shortens long container paths while retaining each semantic source.
Content hashes may be shared by equal text. Documents, targets, compiler module
origins and diagnostics must remain distinct for different containers/segments.
The [superseded content-only contract](../archived/vfs-hash-routing.md) preserves
the original implementation and the reason its namespace is retired.

## Configuration and identity

The existing `tooling.vfs.hashRouting` boolean remains false by default. There is
no new configuration or public CLI flag. `docHash` remains `xxh64:<hex16>` of the
exact virtual document text. Canonical `vfs_manifest`/`vfs_index` virtual paths,
fields and schemas remain unchanged.

When enabled, semantic routing uses:

```text
origin = JSON.stringify([posix(containerPath), segmentUid || null,
                         normalizedLanguageId || null, effectiveExt || ""])
originHash = sha256(origin)  // lowercase hexadecimal
hashVirtualPath = ".poc-vfs/by-hash/" + docHash + "/" + originHash + effectiveExt
```

`containerPath` is required to construct a hash route. Missing content hash or
origin yields no hash path; the resolver retains the canonical legacy path.
Distinct origins with identical text retain the same docHash and different
routing paths. The in-memory document map likewise keys semantic origin rather
than content. Coalescing remains scoped to its source container.

## Artifact and disk boundaries

When hash routing is enabled, `vfs_path_map` links each canonical virtualPath to
its origin-scoped hashVirtualPath using that row's container, segment, language
and extension. Its row schemaVersion remains 1.0.0: fields and types do not change.
`VFS_HASH_ROUTING_SCHEMA_VERSION` 2.0.0 identifies the routing policy, not a new
artifact shape. The manifest/index continue to retain canonical paths.

The existing VFS disk-path owner encodes unsafe filesystem characters and rejects
absolute/traversing paths. Disk/URI/cache ownership uses the complete routed
path, so equal bytes cannot authorize another source's file or response.

## Tokens and cache admission

Token derivation modes remain unchanged. Full token URIs retain their explicit
virtual path. A content-only token can name multiple paths; token-only lookup
then returns null instead of selecting the latest registered origin. One bounded
ambiguity marker is retained until eviction, without an unbounded set of paths.
Origin-scoped tokens retain ordinary lookup. See [token URIs](vfs-token-uris.md).

Per-file signature version 10 invalidates old routing bundles/artifacts.
Compiler-binding producer 10 and LSP-binding producer 12 invalidate derived
answers from conflated documents. Content-only doc-hash caching retains its
existing schema/key meaning; persistent response-cache and artifact field
schemas are not relaxed. Old content-only paths are not semantic source identity.

## Qualification

`tooling/vfs/hash-origin-authority` checks routing on/off with equal-text whole
files and embedded origins, real different package-relative imported types,
complete compiler type payload parity, target selection, diagnostic attribution,
determinism and container-scoped coalescing. Diagnostic frames are controlled
inputs to the real projection owner; no live server qualification is claimed.
`token-origin-authority` proves ambiguous token rejection and explicit URI
path authority. Existing routing/token and path-map roundtrip cases retain their
positive and missing-hash fallback assertions with full origin inputs.

Related contracts: [manifest](vfs-manifest-artifact.md),
[cold start](vfs-cold-start-cache.md), [I/O batching](vfs-io-batching.md).
