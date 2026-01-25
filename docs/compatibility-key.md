# Compatibility Key

The compatibility key is a stable, content-addressed fingerprint used to prevent mixing incompatible indexes or artifacts. It is computed during indexing and stored in both `index_state.json` and `pieces/manifest.json`. Readers (search, assembly, validation) use it to hard-fail when indexes were produced with different schema or runtime policies.

## Where it is computed

- Source: `src/contracts/compatibility.js` (`buildCompatibilityKey`).
- Called from `src/integrations/core/index.js` after tokenization keys are derived.

The key is `sha1(stableStringify(payload))` where the payload includes:

- **artifactSurfaceMajor**: major version of `ARTIFACT_SURFACE_VERSION`.
- **schemaHash**: registry hash for artifact schemas (`ARTIFACT_SCHEMA_HASH`).
- **tokenizationKeys**: per-mode tokenization signatures (from `buildTokenizationKey`).
- **embeddingsKey**: hash of embedding identity/config (null if embeddings disabled).
- **languagePolicyKey**: hash of segment/language/comment policy.
- **modes**: sorted list of modes included in the build.

## Where it is enforced

- `src/shared/artifact-io/manifest.js`: strict readers require a key in manifest/index_state.
- `src/index/build/piece-assembly.js`: hard error on mismatched keys across build inputs.
- `src/retrieval/cli/load-indexes.js`: fails if loaded indexes have different keys.

## When it changes

The key changes when any of the following change:

- Artifact surface major version or schema registry.
- Tokenization behavior (tokenization signatures for a mode).
- Embeddings identity (model/provider/mode/service vs stub).
- Segment/language/comment policy that affects chunking and metadata.
- Enabled modes list (code/prose/extracted-prose/records).

## Troubleshooting

- **Missing key**: treat as incompatible and rebuild. Tests may allow missing keys via `PAIROFCLEATS_TEST_ALLOW_MISSING_COMPAT_KEY`.
- **Mismatch**: rebuild all affected indexes with consistent config/policy and modes.

## Notes

- Only the **major** artifact surface version is included to allow minor/patch changes without forced rebuilds.
- The key is deterministic for a given runtime configuration and mode set.
