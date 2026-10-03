#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { resolveRepoRootArg } from '../shared/dict-utils.js';
import {
  readTargetsManifest,
  resolveHostTargetTriple,
  resolveTargetForTriple,
  resolveTargetsPath,
  sha256Text,
  toPosixRelative
} from './targets.js';
import { buildTargetArtifact, verifyBuiltManifest } from './build-support.js';

const argv = createCli({
  scriptName: 'pairofcleats tui build',
  options: {
    smoke: { type: 'boolean', default: false },
    'verify-manifest': { type: 'boolean', default: false },
    target: { type: 'string', default: '' }
  }
}).parse();

const root = resolveRepoRootArg(null, process.cwd());
const smoke = argv.smoke === true;
const verifyOnly = argv['verify-manifest'] === true;

const run = async () => {
  const { targets } = await readTargetsManifest({ root });
  const targetsPath = resolveTargetsPath(root);
  const targetsBody = await fsPromises.readFile(targetsPath, 'utf8');
  const targetsChecksum = sha256Text(targetsBody);
  if (verifyOnly) {
    const verified = verifyBuiltManifest({ rootDir: root, targets, targetsPath, targetsChecksum });
    process.stderr.write(`[tui-build] verified ${toPosixRelative(root, verified.manifestPath)}\n`);
    return;
  }
  const requestedTriple = String(argv.target || '').trim() || resolveHostTargetTriple();
  const buildTarget = resolveTargetForTriple(targets, requestedTriple);
  if (!buildTarget) {
    throw new Error(`unsupported target triple: ${requestedTriple} (not present in tools/tui/targets.json)`);
  }
  const buildResult = await buildTargetArtifact({
    rootDir: root,
    triple: buildTarget.triple,
    env: process.env,
    smoke
  });

  process.stderr.write(`[tui-build] built ${toPosixRelative(root, buildResult.stagedArtifactPath)}\n`);
  process.stderr.write(`[tui-build] wrote ${path.relative(root, buildResult.manifestPath)}\n`);
  process.stderr.write(`[tui-build] wrote ${path.relative(root, buildResult.checksumPath)}\n`);
};

run().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
