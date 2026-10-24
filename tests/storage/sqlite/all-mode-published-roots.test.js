import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { resolveModeExecutionPlan } from '../../../src/storage/sqlite/build/runner/mode-plan.js';
import { buildSqliteIndex } from '../../../src/storage/sqlite/build/runner.js';
import { getRepoCacheRoot, toRealPathSync } from '../../../src/shared/dict-utils.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const temp = resolveTestCachePath(process.cwd(), `sqlite-published-roots-${crypto.randomUUID()}`);
const repo = path.join(temp, 'repo');
const cacheRoot = path.join(temp, 'cache');
const userConfig = { cache: { root: cacheRoot }, sqlite: { use: true, vectorExtension: { enabled: false } } };
applyTestEnv({ cacheRoot, embeddings: 'stub' });
try {
  await fs.mkdir(repo, { recursive: true });
  const repoCacheRoot = getRepoCacheRoot(repo, userConfig);
  const roots = { code: path.join(repoCacheRoot, 'builds', 'generation-C'),
    prose: path.join(repoCacheRoot, 'builds', 'generation-B') };
  roots['extracted-prose'] = roots.code;
  roots.records = roots.code;
  const writeEmpty = async (buildRoot, mode) => {
    const dir = path.join(buildRoot, `index-${mode}`);
    await fs.mkdir(path.join(dir, 'pieces'), { recursive: true });
    await fs.writeFile(path.join(dir, 'chunk_meta.json'), '[]');
    await fs.writeFile(path.join(dir, 'pieces', 'manifest.json'), JSON.stringify({
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, mode, buildId: path.basename(buildRoot),
      pieces: [{ name: 'chunk_meta', path: 'chunk_meta.json', format: 'json', count: 0 }]
    }));
  };
  for (const [mode, buildRoot] of Object.entries(roots)) await writeEmpty(buildRoot, mode);
  // A code-root prose artifact must never override the separately pinned mode.
  await writeEmpty(roots.code, 'prose');
  const currentPath = path.join(repoCacheRoot, 'builds', 'current.json');
  const pointer = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: 'generation-C',
    buildRoot: path.relative(repoCacheRoot, roots.code),
    buildRootsByMode: Object.fromEntries(Object.entries(roots).map(([mode, buildRoot]) => [mode, path.relative(repoCacheRoot, buildRoot)])) };
  await fs.writeFile(currentPath, JSON.stringify(pointer));
  const input = { modeArg: 'all', root: repo, argv: {}, userConfig };
  const plan = resolveModeExecutionPlan(input);
  assert.equal(plan.errorMessage, undefined);
  for (const [mode, buildRoot] of Object.entries(roots)) {
    assert.equal(toRealPathSync(plan.modeIndexRoots[mode]), toRealPathSync(buildRoot));
    assert.equal(toRealPathSync(plan.modeIndexDirs[mode]), toRealPathSync(path.join(buildRoot, `index-${mode}`)));
  }
  const built = await buildSqliteIndex({ root: repo, userConfig, emitOutput: false, noCompact: true });
  assert.equal(built.ok, true);
  for (const [mode, buildRoot] of Object.entries(roots)) {
    assert.equal(toRealPathSync(built.outputPaths[mode]), toRealPathSync(path.join(buildRoot, 'index-sqlite', `index-${mode}.db`)));
    await fs.access(path.join(buildRoot, `index-${mode}`, 'pieces', 'sqlite-zero-state.json'));
  }
  await assert.rejects(fs.access(path.join(roots.code, 'index-prose', 'pieces', 'sqlite-zero-state.json')));
  assert.deepEqual(JSON.parse(await fs.readFile(currentPath, 'utf8')), pointer);
  const explicit = resolveModeExecutionPlan({ ...input, argv: { 'index-root': roots.code } });
  assert.ok(Object.values(explicit.modeIndexRoots).every(buildRoot => toRealPathSync(buildRoot) === toRealPathSync(roots.code)));
  const moved = path.join(repoCacheRoot, 'builds', 'generation-D');
  await writeEmpty(moved, 'prose');
  pointer.buildRootsByMode.prose = path.relative(repoCacheRoot, moved);
  await fs.writeFile(currentPath, JSON.stringify(pointer));
  assert.equal(toRealPathSync(resolveModeExecutionPlan(input).modeIndexRoots.prose), toRealPathSync(moved),
    'cached code root must not hide a changed prose pointer');
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
console.log('all-mode SQLite follows each published generation');
