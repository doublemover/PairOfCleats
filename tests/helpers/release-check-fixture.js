import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { runNode } from './run-node.js';
import { prepareTestCacheDir } from './test-cache.js';

const root = process.cwd();
const releaseCheckScript = path.join(root, 'tools', 'release', 'check.js');

export const runReleaseCheckCli = async ({
  outDirName,
  extraArgs = []
} = {}) => {
  const resolvedOutDirName = typeof outDirName === 'string' && outDirName.trim()
    ? outDirName.trim()
    : 'release-check';
  const { dir: outDir } = await prepareTestCacheDir(resolvedOutDirName);
  const reportPath = path.join(outDir, 'release_check_report.json');
  const manifestPath = path.join(outDir, 'release-manifest.json');

  const args = [
    releaseCheckScript,
    '--dry-run',
    ...extraArgs,
    '--report',
    reportPath,
    '--manifest',
    manifestPath
  ];
  const run = runNode(args, 'release-check fixture command', root, process.env, {
    stdio: 'pipe',
    encoding: 'utf8',
    allowFailure: true
  });
  return { run, root, outDir, reportPath, manifestPath };
};

export const loadReleaseCheckArtifacts = async ({ reportPath, manifestPath }) => {
  const report = JSON.parse(await fsPromises.readFile(reportPath, 'utf8'));
  const manifest = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));
  return { report, manifest };
};
