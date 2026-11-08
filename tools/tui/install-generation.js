import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteText } from '../../src/shared/io/atomic-write.js';
import { copyFileWithDurability } from '../../src/shared/io/persistence-helpers.js';
import { syncParentDirectory } from '../../src/shared/io/directory-sync.js';
import { acquireFileLock, releaseFileLockOrThrow } from '../../src/shared/locks/file-lock.js';
import { assertNoSymlinkPath, readVerifiedContainedFile, readVerifiedContainedFileSync } from '../../src/shared/contained-file.js';
import { inspectExecutableTargetBytes } from '../../src/shared/binary-target.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { stableStringify } from '../../src/shared/stable-json.js';
import { ensureExecutableModeSync, isExecutableForPlatform, TUI_INSTALL_LAYOUT_VERSION,
  TUI_INSTALL_METADATA_FILE, toPosixRelative } from './targets.js';

export const TUI_INSTALL_GENERATION_SCHEMA_VERSION = 2;
const MAX_BINARY_BYTES = 128 * 1024 * 1024;
const MAX_METADATA_BYTES = 256 * 1024;
const generationIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const read = (root, file, maxBytes) => readVerifiedContainedFile(root, file, { maxBytes });
const runtimeIdentity = packageSha256 => ({ nodeVersion: process.version, nodeAbi: process.versions.modules,
  hostPlatform: process.platform, hostArch: process.arch, packageSha256 });
const snapshotRuntime = async root => runtimeIdentity((await read(root, path.join(root, 'package.json'), MAX_METADATA_BYTES)).hash);
const same = (left, right) => stableStringify(left) === stableStringify(right);

export const verifyStagedTuiBinary = async ({ root, file, target, expectedSha256 }) => {
  const verified = await read(root, file, MAX_BINARY_BYTES);
  if (!/^[a-f0-9]{64}$/u.test(expectedSha256 || '') || verified.hash !== expectedSha256) {
    throw new Error(`staged artifact checksum mismatch for ${target.artifactName}`);
  }
  if (!isExecutableForPlatform(verified.stat, process.platform)) throw new Error(`staged artifact is not executable: ${target.artifactName}`);
  const executableTarget = inspectExecutableTargetBytes(verified.buffer, target);
  return { sha256: verified.hash, sizeBytes: verified.stat.size, executableTarget,
    executable: true, mode: process.platform === 'win32' ? null : verified.stat.mode & 0o777 };
};

/** Read the selected immutable generation, never the current build directory.
 * Legacy v1 installs retain their existing fixed-path validation in the wrapper.
 */
export const resolveSelectedTuiGeneration = ({ root, layout, target, metadata }) => {
  if (metadata.schemaVersion === 1) return { binaryPath: layout.binaryPath, generation: false };
  if (metadata.schemaVersion !== TUI_INSTALL_GENERATION_SCHEMA_VERSION
    || metadata.layoutVersion !== TUI_INSTALL_LAYOUT_VERSION || !generationIdPattern.test(metadata.generationId || '')
    || metadata.triple !== target.triple || metadata.platform !== target.platform || metadata.artifactName !== target.artifactName) {
    throw new Error('Invalid TUI generation identity; reinstall the TUI.');
  }
  const generationDir = path.join(layout.tripleDir, 'generations', metadata.generationId);
  const binaryPath = path.join(generationDir, target.artifactName);
  if (metadata.binary?.path !== toPosixRelative(root, binaryPath)
    || metadata.source?.artifactSha256 !== metadata.binary?.sha256) throw new Error('TUI generation binary/source identity mismatch.');
  const manifest = readVerifiedContainedFileSync(layout.tripleDir,
    path.join(generationDir, TUI_INSTALL_METADATA_FILE), { maxBytes: MAX_METADATA_BYTES });
  if (!same(JSON.parse(manifest.buffer.toString('utf8')), metadata)) throw new Error('TUI current and generation manifests disagree.');
  const packageFile = readVerifiedContainedFileSync(root, path.join(root, 'package.json'), { maxBytes: MAX_METADATA_BYTES });
  if (!same(metadata.runtime, runtimeIdentity(packageFile.hash))) throw new Error('TUI runtime identity changed; reinstall the TUI.');
  const binaryRead = readVerifiedContainedFileSync(layout.tripleDir, binaryPath, { maxBytes: MAX_BINARY_BYTES });
  if (binaryRead.hash !== metadata.binary.sha256 || binaryRead.stat.size !== metadata.binary.sizeBytes
    || !same(inspectExecutableTargetBytes(binaryRead.buffer, target), metadata.binary.executableTarget)) {
    throw new Error('TUI generation binary checksum, size or executable target mismatch.');
  }
  return { binaryPath, generation: true, binaryRead };
};

/** One per-target transaction using the existing lock and durable atomic writer.
 * Unselected generations remain available for explicit recovery/owned retention;
 * no installer removes a sibling generation or an executable in active use.
 */
export const installTuiGeneration = async ({ root, layout, target, resolveBuild,
  eventLogDir = layout.logsDir, onPhase = () => {} }) => {
  let phase = 'admission', generationDir = null, lock = null, failure, failed = false, selected = false;
  const advance = async next => { phase = next; await onPhase(next); };
  try {
    assertNoSymlinkPath(path.parse(layout.tripleDir).root, layout.tripleDir, { allowMissing: true });
    await fs.mkdir(layout.tripleDir, { recursive: true });
    lock = await acquireFileLock({ lockPath: path.join(layout.tripleDir, 'install.lock'), waitMs: 5000,
      timeoutBehavior: 'throw', timeoutMessage: 'TUI installation is busy. Wait for the active installer and retry.',
      metadata: { operation: 'tui-install', triple: target.triple } });
    await advance('source-build');
    const resolvedBuild = await resolveBuild();
    const { buildManifest, buildArtifact } = resolvedBuild;
    if (buildArtifact.triple !== target.triple || buildArtifact.platform !== target.platform
      || buildArtifact.artifactName !== target.artifactName) throw new Error('Build artifact target disagrees with selected TUI target.');
    const runtime = await snapshotRuntime(root);
    const supervisor = await read(root, path.join(root, 'tools', 'tui', 'supervisor.js'), 8 * 1024 * 1024);
    await advance('staging');
    const generations = path.join(layout.tripleDir, 'generations');
    assertNoSymlinkPath(layout.tripleDir, generations, { allowMissing: true });
    await fs.mkdir(generations, { recursive: true });
    const generationId = randomUUID();
    generationDir = path.join(generations, generationId);
    await fs.mkdir(generationDir);
    const binaryPath = path.join(generationDir, target.artifactName);
    // COPYFILE_EXCL + original descriptor/identity and durability owner. A failed
    // close remains an original prerequisite of the install lock's release.
    assertNoSymlinkPath(path.parse(buildArtifact.absoluteArtifactPath).root, buildArtifact.absoluteArtifactPath);
    await copyFileWithDurability(buildArtifact.absoluteArtifactPath, binaryPath, { exclusive: true });
    await advance('executable-metadata');
    ensureExecutableModeSync(binaryPath);
    await advance('staged-validation');
    const binary = await verifyStagedTuiBinary({ root: generationDir, file: binaryPath, target,
      expectedSha256: buildArtifact.sha256 });
    // Logs are deliberately outside immutable generations; failure here cannot
    // change the currently selected executable or metadata.
    await fs.mkdir(eventLogDir, { recursive: true });
    const metadata = { schemaVersion: TUI_INSTALL_GENERATION_SCHEMA_VERSION,
      layoutVersion: TUI_INSTALL_LAYOUT_VERSION, generationId, triple: target.triple, platform: target.platform,
      artifactName: target.artifactName, runtime,
      supervisor: { path: 'tools/tui/supervisor.js', sha256: supervisor.hash },
      binary: { path: toPosixRelative(root, binaryPath), ...binary },
      source: { buildManifestPath: toPosixRelative(root, buildManifest.manifestPath),
        buildManifestChecksum: buildManifest.manifestChecksum, artifactPath: buildArtifact.artifactPath,
        artifactSha256: buildArtifact.sha256 },
      observability: { eventLogDir: toPosixRelative(root, eventLogDir) } };
    const body = `${stableStringify(metadata)}\n`;
    await advance('generation-manifest');
    await atomicWriteText(path.join(generationDir, TUI_INSTALL_METADATA_FILE), body);
    await syncParentDirectory(generationDir);
    await advance('promotion-validation');
    const sealed = await read(generationDir, path.join(generationDir, TUI_INSTALL_METADATA_FILE), MAX_METADATA_BYTES);
    if (sealed.buffer.toString('utf8') !== body) throw new Error('Staged TUI manifest changed before promotion.');
    await verifyStagedTuiBinary({ root: generationDir, file: binaryPath, target, expectedSha256: binary.sha256 });
    if (!same(runtime, await snapshotRuntime(root))
      || supervisor.hash !== (await read(root, path.join(root, 'tools', 'tui', 'supervisor.js'), 8 * 1024 * 1024)).hash) {
      throw new Error('TUI package/runtime changed during staging. Retry installation from a stable checkout.');
    }
    await advance('promotion');
    assertNoSymlinkPath(layout.tripleDir, layout.metadataPath, { allowMissing: true });
    await atomicWriteText(layout.metadataPath, body);
    selected = true;
    phase = 'complete';
    return { resolvedBuild, binaryPath, metadata, checksum: binary.sha256,
      transaction: { state: 'published', generationId, priorGenerations: 'retained', retirement: 'not-requested' } };
  } catch (error) {
    failed = true;
    failure = addStorageFailureContext(error, { tuiInstallPhase: phase,
      tuiInstallSelection: selected ? 'published' : phase === 'promotion' ? 'promotion-unconfirmed' : 'unchanged',
      tuiInstallStaging: generationDir, tuiInstallRecovery: generationDir ? 'retained-unselected-generation' : 'no-generation-created' },
    null, { secondaryPresent: false });
    throw failure;
  } finally {
    if (lock) {
      try { await releaseFileLockOrThrow(lock, failed ? { workerError: failure } : {}); }
      catch (error) {
        throw addStorageFailureContext(error, { tuiInstallPhase: 'lock-release',
          tuiInstallSelection: selected ? 'published' : phase === 'promotion' ? 'promotion-unconfirmed' : 'unchanged',
          tuiInstallStaging: generationDir }, null, { secondaryPresent: false });
      }
    }
  }
};
