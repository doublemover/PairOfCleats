# Spec: Tooling provider registry (current)

> Purpose: standardize tooling provider registration, selection, and orchestration for deterministic enrichment. This document reflects the current implementation in `src/index/tooling/provider-registry.js` and `src/index/tooling/orchestrator.js`.

## 1) Registry surface

```js
export const TOOLING_PROVIDERS = new Map();

export function registerToolingProvider(provider) {
  // validates id/version/capabilities/getConfigHash/run
  TOOLING_PROVIDERS.set(normalizeProviderId(provider.id), provider);
}

export function listToolingProviders(toolingConfig = null) {
  // includes configured LSP providers
}

export function selectToolingProviders({ toolingConfig, documents, targets, providerIds, kinds }) {
  // returns ordered provider plans: [{ provider, documents, targets }]
}
```

## 2) Provider interface (current)

Providers must pass `validateToolingProvider`:

```ts
type ToolingProvider = {
  id: string;
  version: string;
  capabilities: Record<string, any>;
  languages?: string[];
  kinds?: string[];
  priority?: number;   // lower = earlier
  enabled?: boolean;
  requires?: { cmd?: string };

  getConfigHash(ctx: ToolingRunContext): string;
  run(ctx: ToolingRunContext, inputs: ToolingRunInputs): Promise<ToolingProviderOutput>;
};
```

Notes:
- `normalizeProviderId` lowercases and trims ids.
- `capabilities` is required but schema is provider-defined.

## 3) Provider selection and ordering

Selection inputs:
- `toolingConfig.enabledTools` / `toolingConfig.disabledTools`
- `toolingConfig.providerOrder` (explicit order list)
- `providerIds` (explicit run list)
- `kinds` filter
- `documents` / `targets` languageIds

Ordering rules:
1. If `providerIds` is supplied, only those providers are used (in provided order).
2. Else if `providerOrder` exists, those ids are used first in that order.
3. Remaining providers are appended sorted by `(priority, id)`.

Filtering rules:
- Skip providers in `disabledTools`.
- If `enabledTools` list is non-empty, only providers in that list are allowed.
- Skip providers with `provider.enabled === false`.
- If `kinds` filter is supplied, require overlap with `provider.kinds`.
- If `provider.languages` is set, only include documents/targets matching those languageIds.

## 4) Orchestrator: runToolingProviders

Signature:

```ts
async function runToolingProviders(ctx, inputs, providerIds?): Promise<{
  byChunkUid: Map<string, ToolingEntry>;
  sourcesByChunkUid: Map<string, Set<string>>;
  diagnostics: Record<string, any>;
  observations: Array<{ level: string; code: string; message: string; context?: any }>;
}>;
```

Key behaviors:
- `strict` defaults to true; missing `chunkUid` in targets or provider outputs is an error.
- Builds lookup maps from targets:
  - `chunkUidByChunkId` for `byChunkId` outputs.
  - `chunkUidByLegacyKey` for `byLegacyKey` outputs (`<file>::<symbolName>`).
- Provider outputs may use:
  - `byChunkUid`, `byChunkId`, or `byLegacyKey` (all are normalized to `byChunkUid`).

## 5) Caching

If `ctx.cache.enabled` is true:
- Cache directory: `ctx.cache.dir` (created if missing).
- Cache key: `sha1("<providerId>|<providerVersion>|<configHash>|<docKey>")`.
- `docKey` is a stable join of `virtualPath:docHash` for documents (sorted).
- Cache file: `<cacheDir>/<providerId>-<cacheKey>.json`.
- Cache hit is accepted only if provider id/version/configHash match.

## 6) Merge semantics

The orchestrator merges provider outputs into a single `byChunkUid` map.

For each chunk entry:
- `payload.returnType` and `payload.signature` are filled once (first provider wins).
- `payload.paramTypes` are merged per param name:
  - entries are deduped by `(type, source)`
  - list sorted deterministically
  - capped at 5 entries per param
  - truncation emits an `observations` warning
- `symbolRef` is taken from the first provider that supplies it.
- `provenance` is appended per provider (or defaulted to `{provider, version, collectedAt}`).

## 7) Tests

Existing tests cover key behaviors:
- `tests/tooling/providers/provider-registry-normalizes-legacy-keys.test.js`
- `tests/tooling/providers/provider-registry-merges-deterministically.test.js`
- `tests/tooling/providers/provider-registry-strict-missing-chunkuid.test.js`
- `tests/tooling/providers/provider-registry-ordering.test.js`
- `tests/tooling/providers/provider-registry-gating.test.js`
