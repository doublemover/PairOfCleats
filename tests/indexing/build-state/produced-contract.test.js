import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { getRepoCacheRoot, loadUserConfig } from '../../../src/shared/dict-utils.js';
import { readCurrentBuildGeneration } from '../../../src/shared/indexing/build-generation.js';
import { BUILD_STATE_SCHEMA } from '../../../src/contracts/schemas/build-state.js';
import { validateConfig } from '../../../src/config/validate.js';
import { observeIndexPublication } from '../../../tools/tui/operator/index-workflows.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { initGitRepo } from '../../helpers/git-fixture.js';

const { dir } = await prepareIsolatedTestCacheDir('build-state-produced-contract');
const repo = path.join(dir, 'repo'); await fs.mkdir(repo); initGitRepo(repo);
await fs.writeFile(path.join(repo, 'answer.js'), 'export function producedAnswer() { return 42; }\n');
await fs.writeFile(path.join(repo, '.pairofcleats.json'), '{"threads":1,"quality":"fast"}');
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'stub', syncProcess: true,
  extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const result = await spawnSubprocess(process.execPath, [path.join(process.cwd(), 'bin/pairofcleats.js'),
  'index', 'build', '--repo', repo, '--mode', 'code', '--threads', '1', '--stub-embeddings', '--progress=off'],
{ cwd: repo, env, timeoutMs: 25000, maxOutputBytes: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], rejectOnNonZeroExit: false });
await fs.writeFile(path.join(dir, 'build-result.json'), JSON.stringify(result, null, 2));
assert.equal(result.exitCode, 0, result.stderr);
const config = loadUserConfig(repo), repoCacheRoot = getRepoCacheRoot(repo, config), buildsRoot = path.join(repoCacheRoot, 'builds');
const generation = readCurrentBuildGeneration({ repoRoot: repo, repoCacheRoot, buildsRoot, currentJsonPath: path.join(buildsRoot, 'current.json') });
assert.equal(generation.parseOk, true);
const state = JSON.parse(await fs.readFile(path.join(generation.buildRoot, 'build_state.json'), 'utf8'));
const validation = validateConfig(BUILD_STATE_SCHEMA, state);
assert.equal(validation.ok, true, JSON.stringify(validation.errors));
assert.deepEqual(state.orderingLedger.stages['stage1:code'].artifacts, {});
assert.ok(state.analysisShortcuts.code);
assert.ok(state.byteBudgets.policies.chunk_meta);
assert.deepEqual(Object.keys(state.signatures.code.dependencySignatures).sort(), ['artifacts', 'embeddings', 'enrichment', 'lexical', 'parse']);
const publication = await observeIndexPublication(repo, config);
assert.equal(publication.ready, true, JSON.stringify(publication));
for (const mutate of [
  value => { value.unsupportedRootField = true; },
  value => { value.analysisShortcuts.code.disableImportGraph = 'false'; },
  value => { value.byteBudgets.policies.chunk_meta.overflow = 'unknown'; },
  value => { value.signatures.code.dependencySignatures.parse = 42; },
  value => { delete value.orderingLedger.stages['stage1:code'].artifacts; },
  value => { value.completedStages.code.extra = true; },
  value => { value.completedStages.code.schemaVersion = '2'; },
  value => { value.completedStages.code.output.bytes = -1; },
  value => { value.completedStages.code.sourceValidation.status = 'unknown'; },
  value => { value.completedStages.code.snapshot.descriptorHash = 'wrong'; }
]) {
  const invalid = structuredClone(state); mutate(invalid);
  assert.equal(validateConfig(BUILD_STATE_SCHEMA, invalid).ok, false, 'strict field/error contracts stay enforced');
}
console.log('An actual full stub/SQLite build satisfies the complete build-state contract; malformed fields remain rejected.');
