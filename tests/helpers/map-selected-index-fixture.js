import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getCurrentBuildInfo, getRepoCacheRoot, loadUserConfig } from '../../tools/shared/dict-utils.js';
import { writeArtifactPublicationRecord, writeArtifactPublicationValidationReport } from '../../src/index/build/artifact-publication.js';
import { promoteBuild } from '../../src/index/build/promotion.js';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { writePiecesManifest } from '../../src/index/build/artifacts/checksums.js';
import { createBaseIndex } from '../indexing/validate/helpers.js';
import { prepareIsolatedTestCacheDir } from './test-cache.js';
import { applyTestEnv } from './test-env.js';
import { runNode } from './run-node.js';
import { initGitRepo } from './git-fixture.js';

/** Map cache identity consumes complete selected artifact generations. Parser
 * and full Stage1 lifecycle acceptance stay with their existing dedicated cases;
 * this fixture uses real validation/publication/promotion owners for two tiny
 * distinct generations rather than indexing the same repository twice. */
export const createMapSelectedIndexFixture = async label => {
  const root = process.cwd(), { dir: temp } = await prepareIsolatedTestCacheDir('msi-' + label);
  const repo = path.join(temp, 'repo'); await fs.mkdir(path.join(repo, 'src'), { recursive: true });
  initGitRepo(repo);
  const env = applyTestEnv({ cacheRoot: path.join(temp, 'cache'), embeddings: 'off',
    extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
  const config = loadUserConfig(repo), repoCacheRoot = getRepoCacheRoot(repo, config), cacheDir = path.join(repoCacheRoot, 'maps/cache');
  const within = filename => {
    const relative = path.relative(temp, filename);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'only disposable fixture paths may move or be removed');
  };
  const build = async (name, destination) => {
    const text = `export function ${name}() { return '${name}'; }\n`;
    await fs.writeFile(path.join(repo, 'src/current.js'), text);
    const buildId = `fixture-${name}`, buildRoot = path.join(repoCacheRoot, 'builds', buildId);
    const indexState = { buildId, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, mode: 'code', stage: 'stage1',
      generatedAt: '2026-11-05T00:00:00.000Z', counts: { files: 1, chunks: 1 } };
    within(buildRoot); within(destination);
    const fixture = await createBaseIndex({ rootDir: path.join(buildRoot, 'seed'),
      chunkMeta: [{ id: 0, file: 'src/current.js', start: 0, end: text.length, startLine: 1, endLine: 1,
        kind: 'FunctionDeclaration', name, lang: 'javascript' }],
      indexState,
      manifestOverrides: { buildId, mode: 'code', stage: 'stage1' } });
    const outDir = path.join(buildRoot, 'index-code'); within(fixture.indexDir); within(outDir);
    await fs.rename(fixture.indexDir, outDir);
    const manifestPath = path.join(outDir, 'pieces', 'manifest.json');
    // Identity is bound to real content checksums, including same-length source
    // replacement under a retained build ID, as in the original full producer.
    await writePiecesManifest({ outDir, mode: 'code', indexState, pieceEntries: fixture.manifest.pieces });
    const pieceEntries = JSON.parse(await fs.readFile(manifestPath, 'utf8')).pieces;
    const publicationValidation = await writeArtifactPublicationValidationReport({ buildRoot, outDir, mode: 'code',
      buildId, pieceEntries, manifestPath });
    await writeArtifactPublicationRecord({ buildRoot, outDir, mode: 'code', stage: 'stage1', buildId,
      pieceEntries, manifestPath, publicationValidation });
    await promoteBuild({ repoRoot: repo, userConfig: config, buildRoot, buildId, stage: 'stage1', modes: ['code'] });
    const info = getCurrentBuildInfo(repo, config, { mode: 'code' });
    assert.equal(info?.buildId, buildId); within(info.activeRoot);
    await fs.cp(info.activeRoot, destination, { recursive: true });
    return info;
  };
  const map = (selected = null, allowFailure = false) => {
    const result = runNode([path.join(root, 'tools/reports/report-code-map.js'), '--repo', repo, '--format', 'json',
      ...(selected ? ['--index-root', selected] : [])], 'map selected index identity', repo, env,
    { stdio: 'pipe', allowFailure: true, timeoutMs: 5000 });
    if (allowFailure) return result;
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, '');
    const model = JSON.parse(result.stdout), { exportedAt, ...provenance } = model.provenance;
    assert.ok(Number.isFinite(Date.parse(exportedAt)));
    return { ...model, provenance };
  };
  const a = path.join(temp, 'index-a'), b = path.join(temp, 'index-b');
  const firstBuild = await build('alphaOrigin', a), secondBuild = await build('bravoOrigin', b);
  assert.notEqual(firstBuild.buildId, secondBuild.buildId);
  return { temp, repo, config, cacheDir, a, b, firstBuild, secondBuild, map,
    names: model => [...new Set(model.nodes.flatMap(node => node.members.map(member => member.name)))],
    cacheFiles: () => fs.readdir(cacheDir), close: async () => {
      const relative = path.relative(process.cwd(), temp);
      assert.ok(relative.startsWith(`.tmp${path.sep}`) && !relative.startsWith('..'));
      await fs.rm(temp, { recursive: true, force: true });
    } };
};
