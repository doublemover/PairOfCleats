# JSDoc Standards

This guide defines required JSDoc for new/shared modules and any performance-sensitive code paths. The goal is to make behavior, invariants, and determinism explicit so changes remain safe and reviewable.

## Required sections

Every exported function in a new/shared module MUST include:
- **Purpose**: one sentence on what the function does.
- **Inputs/Outputs**: `@param` and `@returns` types with short descriptions.
- **Error behavior**: `@throws` when errors can be raised and what they mean.
- **Side effects**: file IO, cache writes, global state changes.

Performance-sensitive functions MUST additionally document:
- **Determinism**: ordering guarantees, sort keys, stable output constraints.
- **Concurrency**: thread/queue usage, locking, or reuse assumptions.
- **Cache behavior**: keying, invalidation, pruning, and scope.
- **Path handling**: repo-relative vs absolute, POSIX normalization rules.

## Examples

### Minimal (allowed for non-critical helpers)
```js
/**
 * Normalize a repo-relative path to POSIX form.
 * @param {string} relPath
 * @returns {string}
 */
export function toPosix(relPath) {}
```

### Full (required for perf-sensitive modules)
```js
/**
 * Resolve the embeddings cache root.
 *
 * Deterministic: path is computed from config/env only.
 * Cache rules: global scope uses OS cache root; repo scope nests under repo cache.
 * Path handling: returns an absolute OS path; callers must not append raw user input.
 *
 * @param {{ repoCacheRoot?: string, cacheDirConfig?: string, scope?: string }} options
 * @returns {string}
 */
export function resolveEmbeddingsCacheRoot(options) {}
```

## Required tags
- `@param` for each parameter
- `@returns` for return value
- `@throws` for explicit error conditions

Optional but encouraged:
- `@example` for tricky flows
- `@remarks` for invariants or ordering constraints

## Review checklist
- [ ] Determinism is explicit when output order matters.
- [ ] Cache invalidation rules are documented (if cache is used).
- [ ] Path semantics are documented (POSIX vs native).
- [ ] Error behavior is explicit and user-facing messages are mentioned.
