import fs from 'node:fs/promises';
import path from 'node:path';
import {
  getBuildsRoot,
  getRepoCacheRoot,
  getToolVersion
} from '../../../tools/dict-utils.js';
import { writeJsonObjectFile } from '../../shared/json-stream.js';

export async function promoteBuild({
  repoRoot,
  userConfig,
  buildId,
  buildRoot,
  stage,
  modes,
  configHash,
  repoProvenance
}) {
  if (!repoRoot || !buildId || !buildRoot) return null;
  const buildsRoot = getBuildsRoot(repoRoot, userConfig);
  const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
  const relativeRoot = path.relative(repoCacheRoot, buildRoot).split(path.sep).join('/');
  const payload = {
    buildId,
    buildRoot: relativeRoot,
    promotedAt: new Date().toISOString(),
    stage: stage || null,
    modes: Array.isArray(modes) ? modes : null,
    configHash: configHash || null,
    tool: { version: getToolVersion() },
    repo: repoProvenance || null
  };
  await fs.mkdir(buildsRoot, { recursive: true });
  const currentPath = path.join(buildsRoot, 'current.json');
  await writeJsonObjectFile(currentPath, { fields: payload, atomic: true });
  return payload;
}
