import assert from 'node:assert/strict';
import { resolveEnvironmentPreflight } from '../../../src/index/tooling/lsp-provider/preflight-language.js';

const ready = { state: 'ready', reasonCode: null, message: '' };
const warning = { state: 'degraded', reasonCode: 'runtime_missing', message: 'Runtime unavailable' };
const partial = { state: 'degraded', reasonCode: 'rust_workspace_partial_repo_coverage', cached: true,
  blockedWorkspaceKeys: ['rust:broken'], blockedWorkspaceRoots: ['examples/broken'] };
const blocked = { state: 'blocked', reasonCode: 'rust_workspace_blocked_all_partitions',
  blockProvider: true, cached: false, blockedWorkspaceKeys: ['rust:slow'], blockedWorkspaceRoots: ['examples/slow'] };

const denied = resolveEnvironmentPreflight(ready, warning, partial, blocked);
assert.equal(denied.state, 'blocked');
assert.equal(denied.blockProvider, true);
assert.equal(denied.reasonCode, blocked.reasonCode);
assert.equal(denied.cached, false, 'a fresh metadata participant prevents a complete cache-hit claim');
assert.deepEqual(denied.blockedWorkspaceKeys, ['rust:broken', 'rust:slow']);
assert.deepEqual(denied.blockedWorkspaceRoots, ['examples/broken', 'examples/slow']);

const routed = resolveEnvironmentPreflight(warning, partial);
assert.equal(routed.reasonCode, partial.reasonCode, 'partial workspace coverage outranks a lightweight warning');
assert.equal(routed.state, 'degraded');
assert.equal(routed.blockProvider, undefined, 'healthy partitions remain runnable');
assert.deepEqual(routed.blockedWorkspaceKeys, partial.blockedWorkspaceKeys);
assert.equal(routed.cached, true, 'a warning without cache semantics does not erase workspace metadata reuse');

const cachedWarning = resolveEnvironmentPreflight(warning, { ...ready, cached: true });
assert.equal(cachedWarning.state, 'degraded', 'cache reuse does not turn an unavailable runtime into healthy state');
assert.equal(cachedWarning.reasonCode, warning.reasonCode);
assert.equal(cachedWarning.cached, true);
assert.equal(resolveEnvironmentPreflight(ready).cached, false);
assert.equal(resolveEnvironmentPreflight(ready, { ...ready, cached: true, reasonCode: 'workspace_cached' }).reasonCode, 'workspace_cached');
assert.equal(resolveEnvironmentPreflight({ ...ready, cached: true }, { ...ready, cached: true }).cached, true);
assert.equal(resolveEnvironmentPreflight({ ...ready, cached: true }, { ...ready, cached: false }).cached, false);
assert.deepEqual(resolveEnvironmentPreflight(partial, partial).blockedWorkspaceKeys, partial.blockedWorkspaceKeys);
assert.equal(resolveEnvironmentPreflight(warning, { state: 'ready', blockProvider: true }).state, 'blocked');
assert.equal(resolveEnvironmentPreflight(warning, { state: 'ready', blockSourcekit: true }).blockProvider, true);
assert.equal(resolveEnvironmentPreflight(warning, { ...warning, reasonCode: 'later_warning' }).reasonCode, warning.reasonCode);
assert.deepEqual(partial.blockedWorkspaceKeys, ['rust:broken'], 'inputs remain unchanged');
console.log('Preflight denials and partition exclusions outrank warnings; explicit workspace cache state is preserved');
