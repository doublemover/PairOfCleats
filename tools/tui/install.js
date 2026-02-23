#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { removePathWithRetry } from '../../src/shared/io/remove-path-with-retry.js';
import { stableStringify } from '../../src/shared/stable-json.js';
import { resolveRepoRootArg } from '../shared/dict-utils.js';
import {
  TUI_INSTALL_LAYOUT_VERSION,
  ensureExecutableModeSync,
  isExecutableForPlatform,
  readBuildManifestSync,
  readTargetsManifest,
  resolveHostTargetTriple,
  resolveTargetForTriple,
  resolveTuiInstallLayout,
  sha256FileSync,
  toPosixRelative,
  writeStableJsonFile
} from './targets.js';

const argv = createCli({
  scriptName: 'tui-install',
  options: {
    json: { type: 'boolean', default: false },
    target: { type: 'string', default: '' },
    'install-root': { type: 'string', default: '' },
    'event-log-dir': { type: 'string', default: '' }
  }
}).parse();

const root = resolveRepoRootArg(null, process.cwd());

const resolveEventLogDir = ({ layout }) => {
  if (argv['event-log-dir']) {
    return path.resolve(argv['event-log-dir']);
  }
  return layout.logsDir;
};

const pruneInstallBin = async ({ binDir, keepFile }) => {
  if (!fs.existsSync(binDir)) return;
  const entries = await fsPromises.readdir(binDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === keepFile) continue;
    const targetPath = path.join(binDir, entry.name);
    const removed = await removePathWithRetry(targetPath, { recursive: true, force: true });
    if (!removed.ok) {
      throw removed.error || new Error(`failed to remove stale install artifact: ${targetPath}`);
    }
  }
};

const main = async () => {
  const { targets } = await readTargetsManifest({ root });
  const triple = argv.target ? String(argv.target).trim() : resolveHostTargetTriple();
  const target = resolveTargetForTriple(targets, triple);
  if (!target) {
    throw new Error(`unsupported target triple: ${triple} (not present in tools/tui/targets.json)`);
  }

  const buildManifest = readBuildManifestSync({ root, verifyChecksum: true });
  const buildArtifact = resolveTargetForTriple(buildManifest.artifacts, triple);
  if (!buildArtifact) {
    throw new Error(`missing artifact row for ${triple} in ${toPosixRelative(root, buildManifest.manifestPath)}`);
  }
  if (buildArtifact.artifactName !== target.artifactName) {
    throw new Error(
      `target manifest mismatch for ${triple}: expected ${target.artifactName}, got ${buildArtifact.artifactName}`
    );
  }
  if (!buildArtifact.exists || !buildArtifact.absoluteArtifactPath || !fs.existsSync(buildArtifact.absoluteArtifactPath)) {
    throw new Error(`missing TUI artifact: ${buildArtifact.artifactPath}`);
  }
  if (!buildArtifact.sha256) {
    throw new Error(`build manifest is missing sha256 for ${buildArtifact.artifactPath}`);
  }

  const layout = resolveTuiInstallLayout({
    root,
    triple,
    artifactName: target.artifactName,
    installRoot: argv['install-root']
  });
  await fsPromises.mkdir(layout.tripleDir, { recursive: true });
  await fsPromises.mkdir(layout.binDir, { recursive: true });
  await fsPromises.mkdir(layout.logsDir, { recursive: true });

  const tempBinaryPath = `${layout.binaryPath}.tmp-${process.pid}`;
  await fsPromises.copyFile(buildArtifact.absoluteArtifactPath, tempBinaryPath);
  ensureExecutableModeSync(tempBinaryPath);
  await fsPromises.rename(tempBinaryPath, layout.binaryPath);
  await pruneInstallBin({ binDir: layout.binDir, keepFile: target.artifactName });

  const stat = await fsPromises.stat(layout.binaryPath);
  const actualSha256 = sha256FileSync(layout.binaryPath);
  if (actualSha256 !== buildArtifact.sha256) {
    throw new Error(`installed artifact checksum mismatch for ${target.artifactName}`);
  }
  if (!isExecutableForPlatform(stat, process.platform)) {
    throw new Error(`installed artifact is not executable for ${process.platform}: ${target.artifactName}`);
  }

  const eventLogDir = resolveEventLogDir({ layout });
  await fsPromises.mkdir(eventLogDir, { recursive: true });

  const metadata = {
    schemaVersion: 1,
    layoutVersion: TUI_INSTALL_LAYOUT_VERSION,
    triple,
    platform: target.platform,
    artifactName: target.artifactName,
    binary: {
      path: toPosixRelative(root, layout.binaryPath),
      sha256: actualSha256,
      sizeBytes: stat.size,
      executable: true,
      mode: process.platform === 'win32' ? null : (stat.mode & 0o777)
    },
    source: {
      buildManifestPath: toPosixRelative(root, buildManifest.manifestPath),
      buildManifestChecksum: buildManifest.manifestChecksum,
      artifactPath: buildArtifact.artifactPath,
      artifactSha256: buildArtifact.sha256
    },
    observability: {
      eventLogDir: toPosixRelative(root, eventLogDir)
    }
  };
  await writeStableJsonFile(layout.metadataPath, metadata);

  const result = {
    ok: true,
    triple,
    artifact: buildArtifact.artifactPath,
    installedTo: toPosixRelative(root, layout.binaryPath),
    metadata: toPosixRelative(root, layout.metadataPath),
    eventLogDir: toPosixRelative(root, eventLogDir),
    checksum: actualSha256
  };

  if (argv.json) {
    process.stdout.write(`${stableStringify(result)}\n`);
  } else {
    process.stderr.write(`[tui-install] installed ${result.artifact} -> ${result.installedTo}\n`);
    process.stderr.write(`[tui-install] metadata ${result.metadata}\n`);
  }
};

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
