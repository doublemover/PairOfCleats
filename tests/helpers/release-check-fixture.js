import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const releaseCheckScript = path.join(root, 'tools', 'release', 'check.js');

export const runReleaseCheckCli = async ({
  outDirName,
  extraArgs = []
} = {}) => {
  const resolvedOutDirName = typeof outDirName === 'string' && outDirName.trim()
    ? outDirName.trim()
    : 'release-check';
  const outDir = path.join(root, '.testCache', resolvedOutDirName);
  const reportPath = path.join(outDir, 'release_check_report.json');
  const manifestPath = path.join(outDir, 'release-manifest.json');

  await fsPromises.rm(outDir, { recursive: true, force: true });
  await fsPromises.mkdir(outDir, { recursive: true });

  const args = [
    releaseCheckScript,
    '--dry-run',
    ...extraArgs,
    '--report',
    reportPath,
    '--manifest',
    manifestPath
  ];
  const run = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8'
  });
  return { run, root, outDir, reportPath, manifestPath };
};

export const loadReleaseCheckArtifacts = async ({ reportPath, manifestPath }) => {
  const report = JSON.parse(await fsPromises.readFile(reportPath, 'utf8'));
  const manifest = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));
  return { report, manifest };
};
