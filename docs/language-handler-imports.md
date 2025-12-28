# Language Handler Import Strategy

This document evaluates static vs dynamic language handler imports for the language registry.

## Options

### Static registry (current)
All handlers are imported up front into a single registry module.

Pros:
- Deterministic behavior and consistent ordering.
- Simple error surfaces (missing modules fail fast).
- Easier testing: one import path for all handlers.
- Avoids async registry initialization and race conditions.
- Better for bundled or offline environments.

Cons:
- Slightly higher startup cost and memory use.
- All handler code is loaded even when only a subset is used.

### Dynamic imports
Handlers are loaded on demand (per file type or per feature).

Pros:
- Lower initial load cost when indexing a single language.
- Supports plugin-like architectures and optional dependencies.

Cons:
- Adds async orchestration throughout the indexing path.
- Complicates deterministic ordering and test fixtures.
- Harder to bundle for offline usage or MCP packaging.
- Higher failure surface (partial registry, missing modules at runtime).

## Decision (current)
Keep the static registry for predictable behavior and simpler test coverage. Revisit dynamic loading if
plugin packaging or very large language modules make startup cost a proven bottleneck.

## Follow-up ideas
- If dynamic loading is revisited, require a manifest and cache handler module resolution.
- Keep a compatibility path that preserves deterministic ordering for tests and benchmarks.
