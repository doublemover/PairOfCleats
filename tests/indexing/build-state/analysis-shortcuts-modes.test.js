import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { initBuildState, updateBuildState, flushBuildState } from '../../../src/index/build/build-state.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('analysis-shortcuts-modes');
const buildRoot = path.join(dir, 'build');
const statePath = await initBuildState({ buildRoot, buildId: 'shortcut-modes', repoRoot: dir,
  modes: ['code', 'prose'], stage: 'stage2' });
const code = { profileId: 'default', disableImportGraph: false, disableCrossFileInference: false,
  tinyRepoFastPath: null };
const prose = { profileId: 'default', disableImportGraph: true, disableCrossFileInference: true,
  tinyRepoFastPath: { active: true, estimatedLines: 1, totalBytes: 12, fileCount: 1,
    disableImportGraph: true, disableCrossFileInference: true, minimalArtifacts: false } };
await updateBuildState(buildRoot, { analysisShortcuts: { code } });
await updateBuildState(buildRoot, { analysisShortcuts: { prose } });
await flushBuildState(buildRoot);
assert.deepEqual(JSON.parse(await fs.readFile(statePath, 'utf8')).analysisShortcuts, { code, prose },
  'publishing one mode must retain the previous mode diagnostic evidence');
const revisedCode = { ...code, disableImportGraph: true };
await updateBuildState(buildRoot, { analysisShortcuts: { code: revisedCode } });
await flushBuildState(buildRoot);
assert.deepEqual(JSON.parse(await fs.readFile(statePath, 'utf8')).analysisShortcuts, { code: revisedCode, prose },
  'a refreshed mode replaces its own diagnostic record and preserves other modes');
console.log('Per-mode analysis shortcut evidence survives actual state updates and flushes.');
