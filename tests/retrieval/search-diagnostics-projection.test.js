import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildRetrievalMetadata } from '../../src/retrieval/output/retrieval-metadata.js';
import { explainEmptyResults } from '../../src/retrieval/output/empty-results.js';
import { buildSearchDiagnostics } from '../../src/retrieval/output/search-diagnostics.js';
import { assertTuiSearchDiagnostics } from '../../src/contracts/validators/tui-search.js';

const require = createRequire(import.meta.url);
const { normalizeSearchDiagnostics } = require('../../extensions/vscode/search-explanation.js');
const metadata = buildRetrievalMetadata({ backendLabel: 'memory',
  backendPolicyInfo: { requested: 'sqlite', reason: 'sqlite-unavailable' },
  idxCode: { state: { buildId: 'build-recorded', artifactSurfaceVersion: 1, profile: { id: 'profile-recorded' } } },
  indexSignaturePayload: { modes: { code: 'signature-recorded' }, generationByMode: { code: {
    generationKey: 'generation-recorded', activeBuildRoot: 'C:/private/hidden-build-root' } } }
});
for (const options of [{}, { filtersActive: true }, { filterEnumeration: { kind: 'metadata' } }]) {
  metadata.emptyResults = explainEmptyResults({ ...options, backend: metadata.backend });
  const diagnostics = buildSearchDiagnostics(metadata);
  assert.equal(assertTuiSearchDiagnostics(diagnostics), diagnostics);
  assert.deepEqual(normalizeSearchDiagnostics(diagnostics), diagnostics, 'editor and supervisor preserve the producer facts');
  assert.equal(diagnostics.backend.selected, 'memory');
  assert.equal(diagnostics.backend.requested, 'sqlite');
  assert.equal(diagnostics.backend.fidelity, 'fallback-derived');
  assert.deepEqual(diagnostics.reasons.map(row => row.code), metadata.emptyResults.map(row => row.code));
  assert.equal(diagnostics.generations[0].generationKey, 'generation-recorded');
  assert.equal(diagnostics.generations[0].artifactSurfaceVersion, '1');
  assert.ok(diagnostics.details.some(line => line.includes('does not verify the current worktree')));
  assert.ok(!JSON.stringify(diagnostics).includes('private/hidden-build-root'));
  assert.deepEqual(diagnostics.actions.sort(), ['index-report', 'tooling-doctor']);
}

const nonemptyFallback = buildSearchDiagnostics({ ...metadata, emptyResults: undefined });
assert.equal(nonemptyFallback.backend.fidelity, 'fallback-derived');
assert.equal(nonemptyFallback.reasons.length, 0, 'never infer an empty reason for nonempty results');
const unknown = buildSearchDiagnostics(null);
assert.equal(unknown.state, 'unknown');
assert.equal(unknown.backend.fidelity, 'unknown');
assert.equal(normalizeSearchDiagnostics(undefined).state, 'unknown');
assert.equal(normalizeSearchDiagnostics(undefined).backend.fidelity, 'unknown');

const untrusted = buildSearchDiagnostics({ backend: { selected: 'memory\x1b[31m\nspoof', requested: 'x'.repeat(1000) },
  emptyResults: Array.from({ length: 100 }, () => ({ code: 'unknown-command', message: '\u202e'.repeat(1000) + 'x'.repeat(1000),
    next: 'arbitrary response command', secret: 'never-persist-secret' })), actions: ['arbitrary-command'], secret: 'never-persist-secret' });
assertTuiSearchDiagnostics(untrusted);
assert.equal(untrusted.truncated, true);
assert.equal(untrusted.reasons.length, 8);
assert.equal(untrusted.actions.length, 0);
assert.ok(!/[\x00-\x1f\x7f-\x9f\u202a-\u202e]/.test(JSON.stringify(untrusted)));
assert.ok(!JSON.stringify(untrusted).includes('never-persist-secret'));
assert.throws(() => assertTuiSearchDiagnostics({ ...unknown, actions: ['shell-command'] }), { code: 'ERR_TUI_SEARCH_OUTPUT' });
console.log('Recorded search diagnostics preserve producer reasons, backend and generation without inventing freshness.');
