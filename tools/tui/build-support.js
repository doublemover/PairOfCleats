import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSubprocessSync } from '../../src/shared/subprocess.js';
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
  resolveTargetForTriple,
  resolveTargetsPath,
  ensureExecutableModeSync,
  sha256FileSync,
  sha256Text,
  toPosixRelative
} from './targets.js';

export const verifyBuiltManifest = ({ rootDir, targets, targetsPath, targetsChecksum }) => {
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

export const stageBuiltArtifact = async ({ rootDir, target, distDirectory, env = process.env }) => {
  const cargoManifestPath = resolveCargoManifestPath(rootDir);
  if (!fs.existsSync(cargoManifestPath)) {
    throw new Error(`missing TUI Cargo manifest: ${toPosixRelative(rootDir, cargoManifestPath)}`);
  }
  const cargoInvocation = resolveCargoCommandInvocation(env);
  const cargoArgs = [
    ...cargoInvocation.args,
    'build',
    '--release',
    '--manifest-path',
    cargoManifestPath,
    '--target',
    target.triple
  ];
  let result = null;
  try {
    result = spawnSubprocessSync(cargoInvocation.command, cargoArgs, {
      cwd: rootDir,
      env,
      stdio: 'inherit',
      rejectOnNonZeroExit: false
    });
  } catch (error) {
    if (error?.code === 'SUBPROCESS_FAILED') {
      throw new Error(
        `failed to spawn cargo for ${target.triple}. Install Rust/Cargo or set ${'`'}PAIROFCLEATS_TUI_CARGO${'`'} to a working cargo command.`
      );
    }
    throw error;
  }
  if (result.exitCode !== 0) {
    throw new Error(
      `cargo build failed for ${target.triple} (exit=${result.exitCode ?? 'unknown'})`
    );
  }
  const builtArtifactPath = resolveCargoBuildOutputPath({
    root: rootDir,
    triple: target.triple,
    env
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

export const buildTargetArtifact = async ({
  rootDir,
  triple,
  env = process.env,
  smoke = false
}) => {
  const { targets } = await readTargetsManifest({ root: rootDir });
  const targetsPath = resolveTargetsPath(rootDir);
  const targetsBody = await fsPromises.readFile(targetsPath, 'utf8');
  const targetsChecksum = sha256Text(targetsBody);
  const distDir = resolveBuildDistDir({ root: rootDir, env });
  await fsPromises.mkdir(distDir, { recursive: true });
  const buildTarget = resolveTargetForTriple(targets, triple);
  if (!buildTarget) {
    throw new Error(`unsupported target triple: ${triple} (not present in tools/tui/targets.json)`);
  }
  const stagedArtifactPath = await stageBuiltArtifact({
    rootDir,
    target: buildTarget,
    distDirectory: distDir,
    env
  });
  const artifacts = targets.map((target) => {
    const artifactPath = path.join(distDir, target.artifactName);
    const exists = fs.existsSync(artifactPath);
    return {
      triple: target.triple,
      platform: target.platform,
      artifactName: target.artifactName,
      artifactPath: path.relative(rootDir, artifactPath).replace(/\\/g, '/'),
      exists,
      sha256: exists ? sha256FileSync(artifactPath) : null
    };
  });

  const manifestPath = path.join(distDir, TUI_BUILD_MANIFEST_FILE);
  const checksumPath = path.join(distDir, TUI_BUILD_MANIFEST_CHECKSUM_FILE);
  const manifest = {
    schemaVersion: TUI_BUILD_MANIFEST_SCHEMA_VERSION,
    tool: 'pairofcleats-tui',
    mode: smoke ? 'smoke' : 'plan',
    pathPolicy: 'repo-relative-posix',
    targetsManifest: {
      file: path.relative(rootDir, targetsPath).replace(/\\/g, '/'),
      sha256: targetsChecksum
    },
    artifacts
  };

  const body = `${stableStringify(manifest)}\n`;
  await fsPromises.writeFile(manifestPath, body, 'utf8');
  const checksum = sha256Text(body);
  await fsPromises.writeFile(checksumPath, `${checksum}  ${TUI_BUILD_MANIFEST_FILE}\n`, 'utf8');

  if (smoke) {
    verifyBuiltManifest({ rootDir, targets, targetsPath, targetsChecksum });
  }

  return {
    distDir,
    target: buildTarget,
    stagedArtifactPath,
    manifestPath,
    checksumPath,
    targets,
    targetsPath,
    targetsChecksum
  };
};

export const ensureBuildArtifactAvailable = async ({
  rootDir,
  triple,
  env = process.env,
  autoBuild = true
}) => {
  const { targets } = await readTargetsManifest({ root: rootDir });
  const target = resolveTargetForTriple(targets, triple);
  if (!target) {
    throw new Error(`unsupported target triple: ${triple} (not present in tools/tui/targets.json)`);
  }
  try {
    const buildManifest = readBuildManifestSync({ root: rootDir, verifyChecksum: true });
    const buildArtifact = resolveTargetForTriple(buildManifest.artifacts, triple);
    if (
      buildArtifact
      && buildArtifact.artifactName === target.artifactName
      && buildArtifact.exists
      && buildArtifact.absoluteArtifactPath
      && fs.existsSync(buildArtifact.absoluteArtifactPath)
      && buildArtifact.sha256
    ) {
      return { target, buildManifest, buildArtifact, built: false };
    }
  } catch {}

  if (!autoBuild) {
    throw new Error(
      `missing staged TUI artifact for ${triple}. Run ${'`'}pairofcleats tui build --target '}${triple}${'`'} first, or rerun install without ${'`'}--no-build${'`'}.`
    );
  }

  const built = await buildTargetArtifact({
    rootDir,
    triple,
    env,
    smoke: true
  });
  const buildManifest = readBuildManifestSync({ root: rootDir, verifyChecksum: true });
  const buildArtifact = resolveTargetForTriple(buildManifest.artifacts, triple);
  if (!buildArtifact || !buildArtifact.exists || !buildArtifact.absoluteArtifactPath || !fs.existsSync(buildArtifact.absoluteArtifactPath)) {
    throw new Error(`build completed but staged TUI artifact is still missing for ${triple}`);
  }
  return {
    target,
    buildManifest,
    buildArtifact,
    built: true,
    stagedArtifactPath: built.stagedArtifactPath
  };
};
