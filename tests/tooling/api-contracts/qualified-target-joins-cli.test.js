import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { initGitRepo } from '../../helpers/git-fixture.js';
import { installPublicationBoundaryDiagnostics } from '../../helpers/publication-boundary-diagnostics.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { getIndexDir, loadUserConfig } from '../../../src/shared/dict-utils.js';
import { loadJsonArrayArtifactRows } from '../../../src/shared/artifact-io/loaders.js';
import { buildApiContractsReport } from '../../../src/integrations/tooling/api-contracts.js';
import { validateApiContracts } from '../../../src/contracts/validators/analysis.js';
import { qualifiedTargetSources } from './qualified-target-source-fixture.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/api-contracts/qualified-target-joins-cli/')[1];
assert.ok(['js-clean', 'ts-clean', 'js-violation', 'ts-violation'].includes(selected));
const diagnostics = installPublicationBoundaryDiagnostics();
const { buildIndex } = await import('../../../src/integrations/core/index.js');
const [language, operation] = selected.split('-');
const root = process.cwd(), { dir } = await prepareIsolatedTestCacheDir(`api-qualified-target-${selected}`);
const repo = path.join(dir, 'repo'); await fs.mkdir(repo); initGitRepo(repo);
for (const [file, bytes] of Object.entries(qualifiedTargetSources(language, operation))) await fs.writeFile(path.join(repo, file), bytes);
// The fixture is a closed source project. Parent checkout ambient @types and
// browser libraries are not inputs to these ECMAScript callable assertions.
// The actual JS/TS ambient-scope comparator qualifies these exact source bytes,
// local symbols/signatures and target joins under ES5 and ES2022, and retains
// a modern-builtin discriminator. Keep the real minimal standard library.
await fs.writeFile(path.join(repo, 'tsconfig.json'), JSON.stringify({ compilerOptions: { types: [], lib: ['es5'] } }));
// Exact API joins need completed compiler bindings. Default manual/deferred
// enrichment deliberately leaves same-name targets ambiguous.
// Keep the actual semantic compiler bindings; legacy cross-file type
// propagation is independent work and supplies no authority to these joins.
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'stub',
  testConfig: { threads: 1, extraIgnore: ['tsconfig.json'], indexing: { semantic: { enabled: true,
    enrichment: { bindings: 'eager', localFlow: 'off', crossFileFlow: 'off' } }, embeddings: { enabled: false },
  typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, riskAnalysisCrossFile: false },
  tooling: { autoEnableOnDetect: false, lsp: { enabled: false } } }, extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const signal = AbortSignal.timeout(10000);
diagnostics.observeSignal(signal);
try {
  await buildIndex(repo, { mode: 'code', stage: 'stage2', 'stub-embeddings': true, 'scm-provider': 'none', threads: 1, abortSignal: signal });
} finally { diagnostics.finish(); }
signal.throwIfAborted();
const args = [path.join(root, 'bin/pairofcleats.js'), 'api-contracts', '--repo', repo, '--json'];
const result = await spawnSubprocess(process.execPath, args, { cwd: root, env, timeoutMs: 5000,
  maxOutputBytes: 256 * 1024, rejectOnNonZeroExit: false });
await fs.writeFile(path.join(dir, 'report-command.json'), JSON.stringify({ args, ...result }, null, 2));
assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stderr, '');
const report = JSON.parse(result.stdout); assert.equal(validateApiContracts(report).ok, true);
const foo = report.symbols.filter(entry => entry.symbol.name === 'foo'); assert.equal(foo.length, 2);
const a = foo.find(entry => entry.symbol.file === `a.${language}`), b = foo.find(entry => entry.symbol.file === `b.${language}`);
assert.ok(a); assert.ok(b); assert.notEqual(a.symbol.chunkUid, b.symbol.chunkUid);
assert.equal(a.observedCalls.length, 1); assert.equal(a.warnings, null);
assert.equal(b.observedCalls.length, operation === 'violation' ? 1 : 0);
for (const entry of foo) for (const call of entry.observedCalls) {
  assert.equal(call.targetChunkUid, entry.symbol.chunkUid); assert.equal(call.join.symbolId, entry.symbol.symbolId);
  assert.equal(call.join.indexSignature, report.provenance.indexSignature);
}
const indexDir = getIndexDir(repo, 'code', loadUserConfig(repo));
const symbols = [], callSites = [];
for await (const row of loadJsonArrayArtifactRows(indexDir, 'symbols', { strict: true })) symbols.push(row);
for await (const row of loadJsonArrayArtifactRows(indexDir, 'call_sites', { strict: true })) callSites.push(row);
assert.ok(callSites.some(row => row.targetChunkUid === a.symbol.chunkUid), 'the installed index supplies the explicit target used by the actual CLI');
const memory = buildApiContractsReport({ symbols, callSites, provenance: report.provenance });
assert.deepEqual(memory.symbols, report.symbols, 'streaming CLI ingestion and in-memory rows have identical qualified joins');
const guardedArgs = [...args, '--failOnWarn', '--maxWarnings', '0'];
const guarded = await spawnSubprocess(process.execPath, guardedArgs, { cwd: root, env, timeoutMs: 5000,
  maxOutputBytes: 256 * 1024, rejectOnNonZeroExit: false });
await fs.writeFile(path.join(dir, 'guarded-command.json'), JSON.stringify({ args: guardedArgs, ...guarded }, null, 2));
assert.equal(guarded.exitCode, operation === 'violation' ? 2 : 0);
assert.equal(guarded.stderr.trim(), operation === 'violation' ? 'API contracts warnings detected.' : '');
if (operation === 'clean') assert.equal(JSON.parse(guarded.stdout).warnings, null);
console.log(JSON.stringify({ selected, dir, reportExit: result.exitCode, guardedExit: guarded.exitCode }));
