#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { spawnSubprocessSync } from '../../src/shared/subprocess.js';
import { resolveRepoRootArg } from '../shared/dict-utils.js';
import { stableStringify } from '../../src/shared/stable-json.js';
import {
  TUI_BUILD_MANIFEST_SCHEMA_VERSION,
  TUI_BUILD_MANIFEST_CHECKSUM_FILE,
  TUI_BUILD_MANIFEST_FILE,
  readBuildManifestSync,
  resolveCargoBuildOutputPath,
  resolveCargoCommandInvocation,
  resolveCargoManifestPath,
  readTargetsManifest,
  resolveBuildDistDir,
  resolveHostTargetTriple,
  resolveTargetForTriple,
  resolveTargetsPath,
  ensureExecutableModeSync,
  sha256FileSync,
  sha256Text,
  toPosixRelative
} from './targets.js';

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

const distDir = resolveBuildDistDir({ root });
const manifestPath = path.join(distDir, TUI_BUILD_MANIFEST_FILE);
const checksumPath = path.join(distDir, TUI_BUILD_MANIFEST_CHECKSUM_FILE);

const verifyBuiltManifest = ({ rootDir, targets, targetsPath, targetsChecksum }) => {
  const buildManifest = readBuildManifestSync({ root: rootDir, verifyChecksum: true });
  const expectedTargetsFile = toPosixRelative(rootDir, targetsPath);
  if (buildManifest.targetsManifest?.file !== expectedTargetsFile) {
    throw new Error(
      `build manifest targets file mismatch: expected ${expectedTargetsFile}, got ${buildManifest.targetsManifest?.file || 'missing'}`
    );
  }
  if (!buildManifest.targetsManifest?.sha256) {
    throw new Error('build manifest missing targets manifest checksum binding');
  }
  if (buildManifest.targetsManifest.sha256 !== targetsChecksum) {
    throw new Error(
      `build manifest targets checksum mismatch: expected ${targetsChecksum}, got ${buildManifest.targetsManifest.sha256}`
    );
  }
  const artifactsByTriple = new Map(
    (Array.isArray(buildManifest.artifacts) ? buildManifest.artifacts : [])
      .map((artifact) => [artifact.triple, artifact])
  );
  for (const target of targets) {
    const artifact = artifactsByTriple.get(target.triple);
    if (!artifact) {
      throw new Error(
        `build manifest missing target ${target.triple} (${toPosixRelative(rootDir, buildManifest.manifestPath)})`
      );
    }
    if (artifact.artifactName !== target.artifactName) {
      throw new Error(
        `build manifest artifact mismatch for ${target.triple}: expected ${target.artifactName}, got ${artifact.artifactName}`
      );
    }
    const onDiskExists = Boolean(artifact.absoluteArtifactPath && fs.existsSync(artifact.absoluteArtifactPath));
    if (artifact.exists !== onDiskExists) {
      throw new Error(
        `build manifest exists mismatch for ${target.triple}: manifest=${artifact.exists} disk=${onDiskExists}`
      );
    }
    if (!artifact.exists) {
      if (artifact.sha256) {
        throw new Error(`build manifest has sha256 for missing artifact: ${artifact.artifactPath}`);
      }
      continue;
    }
    if (!artifact.sha256) {
      throw new Error(`build manifest missing sha256 for ${artifact.artifactPath}`);
    }
    const actualSha = sha256FileSync(artifact.absoluteArtifactPath);
    if (actualSha !== artifact.sha256) {
      throw new Error(`build manifest sha256 mismatch for ${artifact.artifactPath}`);
    }
  }
  return buildManifest;
};

const stageBuiltArtifact = async ({ rootDir, target, distDirectory }) => {
  const cargoManifestPath = resolveCargoManifestPath(rootDir);
  if (!fs.existsSync(cargoManifestPath)) {
    throw new Error(`missing TUI Cargo manifest: ${toPosixRelative(rootDir, cargoManifestPath)}`);
  }
  const cargoInvocation = resolveCargoCommandInvocation(process.env);
  const cargoArgs = [
    ...cargoInvocation.args,
    'build',
    '--release',
    '--manifest-path',
    cargoManifestPath,
    '--target',
    target.triple
  ];
  const result = spawnSubprocessSync(cargoInvocation.command, cargoArgs, {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
    rejectOnNonZeroExit: false
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `cargo build failed for ${target.triple} (exit=${result.exitCode ?? 'unknown'})`
    );
  }
  const builtArtifactPath = resolveCargoBuildOutputPath({
    root: rootDir,
    triple: target.triple,
    env: process.env
  });
  if (!fs.existsSync(builtArtifactPath)) {
    throw new Error(
      `built TUI artifact missing after cargo build: ${toPosixRelative(rootDir, builtArtifactPath)}`
    );
  }
  const stagedArtifactPath = path.join(distDirectory, target.artifactName);
  await fsPromises.copyFile(builtArtifactPath, stagedArtifactPath);
  ensureExecutableModeSync(stagedArtifactPath);
  return stagedArtifactPath;
};

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

  await fsPromises.mkdir(distDir, { recursive: true });
  const requestedTriple = String(argv.target || '').trim() || resolveHostTargetTriple();
  const buildTarget = resolveTargetForTriple(targets, requestedTriple);
  if (!buildTarget) {
    throw new Error(`unsupported target triple: ${requestedTriple} (not present in tools/tui/targets.json)`);
  }
  const stagedArtifactPath = await stageBuiltArtifact({
    rootDir: root,
    target: buildTarget,
    distDirectory: distDir
  });
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
    schemaVersion: TUI_BUILD_MANIFEST_SCHEMA_VERSION,
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

  if (smoke) {
    verifyBuiltManifest({ rootDir: root, targets, targetsPath, targetsChecksum });
  }

  process.stderr.write(`[tui-build] built ${toPosixRelative(root, stagedArtifactPath)}\n`);
  process.stderr.write(`[tui-build] wrote ${path.relative(root, manifestPath)}\n`);
  process.stderr.write(`[tui-build] wrote ${path.relative(root, checksumPath)}\n`);
};

run().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
