#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { stableStringify } from '../../src/shared/stable-json.js';
import {
  TUI_BUILD_MANIFEST_CHECKSUM_FILE,
  TUI_BUILD_MANIFEST_FILE,
  readTargetsManifest,
  resolveTargetsPath,
  sha256FileSync,
  sha256Text
} from './targets.js';

const root = process.cwd();
const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const smoke = hasFlag('--smoke');
const verifyOnly = hasFlag('--verify-manifest');

const distDir = path.join(root, 'dist', 'tui');
const manifestPath = path.join(distDir, TUI_BUILD_MANIFEST_FILE);
const checksumPath = path.join(distDir, TUI_BUILD_MANIFEST_CHECKSUM_FILE);

const run = async () => {
  const { targets } = await readTargetsManifest({ root });
  const targetsPath = resolveTargetsPath(root);
  const targetsBody = await fsPromises.readFile(targetsPath, 'utf8');
  const targetsChecksum = sha256Text(targetsBody);
  if (verifyOnly) {
    process.stderr.write('[tui-build] target manifest verification passed.\n');
    return;
  }

  await fsPromises.mkdir(distDir, { recursive: true });
  const artifacts = targets.map((target) => {
    const artifactPath = path.join(distDir, target.artifactName);
    const exists = fs.existsSync(artifactPath);
    return {
      triple: target.triple,
      platform: target.platform,
      artifactName: target.artifactName,
      artifactPath: path.relative(root, artifactPath).replace(/\\/g, '/'),
      exists,
      sha256: exists ? sha256FileSync(artifactPath) : null
    };
  });

  const manifest = {
    schemaVersion: 1,
    tool: 'pairofcleats-tui',
    mode: smoke ? 'smoke' : 'plan',
    pathPolicy: 'repo-relative-posix',
    targetsManifest: {
      file: path.relative(root, targetsPath).replace(/\\/g, '/'),
      sha256: targetsChecksum
    },
    artifacts
  };

  const body = `${stableStringify(manifest)}\n`;
  await fsPromises.writeFile(manifestPath, body, 'utf8');
  const checksum = sha256Text(body);
  await fsPromises.writeFile(checksumPath, `${checksum}  ${TUI_BUILD_MANIFEST_FILE}\n`, 'utf8');

  process.stderr.write(`[tui-build] wrote ${path.relative(root, manifestPath)}\n`);
  process.stderr.write(`[tui-build] wrote ${path.relative(root, checksumPath)}\n`);
};

run().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
