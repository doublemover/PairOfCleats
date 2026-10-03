import fs from 'node:fs/promises';
import path from 'node:path';
import { replaceDir } from '../../src/shared/json-stream/atomic.js';
import { createBaseIndex } from '../indexing/validate/helpers.js';

const writeJson = async (filePath, value) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

export const seedCodeSnapshotBuildRoot = async ({
  repoCacheRoot,
  buildId,
  chunkMeta,
  fileMeta,
  tokenPostings,
  manifestOverrides = {},
  buildStateOverrides = {}
}) => {
  const buildRoot = path.join(repoCacheRoot, 'builds', buildId);
  await fs.mkdir(buildRoot, { recursive: true });
  const { indexDir } = await createBaseIndex({
    rootDir: buildRoot,
    manifestOverrides,
    chunkMeta,
    fileMeta,
    tokenPostings
  });
  const modeDir = path.join(buildRoot, 'index-code');
  await replaceDir(indexDir, modeDir);
  await fs.rm(path.join(buildRoot, '.index-root'), { recursive: true, force: true });
  await writeJson(path.join(buildRoot, 'build_state.json'), {
    schemaVersion: 1,
    buildId,
    configHash: `cfg-${buildId}`,
    tool: { version: '1.0.0' },
    validation: { ok: true, issueCount: 0, warningCount: 0, issues: [] },
    ...buildStateOverrides
  });
  return { buildRoot, indexDir: modeDir };
};

export const setCurrentCodeSnapshotBuild = async ({
  repoCacheRoot,
  buildId
}) => writeJson(path.join(repoCacheRoot, 'builds', 'current.json'), {
  buildId,
  buildRoot: `builds/${buildId}`,
  buildRoots: {
    code: `builds/${buildId}`
  }
});
