import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stableStringify } from '../../src/shared/stable-json.js';

export const TUI_TARGETS_SCHEMA_VERSION = 1;
export const TUI_BUILD_MANIFEST_FILE = 'tui-artifacts-manifest.json';
export const TUI_BUILD_MANIFEST_CHECKSUM_FILE = `${TUI_BUILD_MANIFEST_FILE}.sha256`;
export const TUI_INSTALL_LAYOUT_VERSION = 1;
export const TUI_INSTALL_LAYOUT_DIR = `install-v${TUI_INSTALL_LAYOUT_VERSION}`;
export const TUI_INSTALL_METADATA_FILE = 'install-manifest.json';
export const TUI_BUILD_DIST_DIR_ENV = 'PAIROFCLEATS_TUI_DIST_DIR';

const normalizeString = (value) => String(value || '').trim();

const normalizeTargetEntry = (entry) => ({
  triple: normalizeString(entry?.triple),
  platform: normalizeString(entry?.platform),
  artifactName: normalizeString(entry?.artifactName)
});

const ensureUniqueTargets = (targets, sourcePath) => {
  const seenTriples = new Set();
  const seenArtifacts = new Set();
  for (const target of targets) {
    if (!target.triple || !target.artifactName) {
      throw new Error(`invalid target entry in ${sourcePath}`);
    }
    if (seenTriples.has(target.triple)) {
      throw new Error(`duplicate triple in ${sourcePath}: ${target.triple}`);
    }
    if (seenArtifacts.has(target.artifactName)) {
      throw new Error(`duplicate artifactName in ${sourcePath}: ${target.artifactName}`);
    }
    seenTriples.add(target.triple);
    seenArtifacts.add(target.artifactName);
  }
};

export const toPosixRelative = (root, filePath) => path.relative(root, filePath).replace(/\\/g, '/');

export const sha256Text = (text) => crypto.createHash('sha256').update(text).digest('hex');

export const sha256FileSync = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

const parseChecksumLine = (line) => {
  const trimmed = normalizeString(line);
  if (!trimmed) return null;
  const match = trimmed.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
  if (!match) return null;
  return {
    hash: match[1].toLowerCase(),
    fileName: normalizeString(match[2])
  };
};

export const verifyTextChecksumFile = ({ body, checksumFilePath, expectedFileName = '' }) => {
  if (!fs.existsSync(checksumFilePath)) {
    throw new Error(`missing checksum file: ${checksumFilePath}`);
  }
  const line = fs.readFileSync(checksumFilePath, 'utf8').split(/\r?\n/).find((entry) => normalizeString(entry)) || '';
  const parsed = parseChecksumLine(line);
  if (!parsed) {
    throw new Error(`invalid checksum file format: ${checksumFilePath}`);
  }
  if (expectedFileName && parsed.fileName !== expectedFileName) {
    throw new Error(`checksum file target mismatch: expected ${expectedFileName}, got ${parsed.fileName}`);
  }
  const actual = sha256Text(body);
  if (actual !== parsed.hash) {
    throw new Error(`checksum verification failed for ${expectedFileName || 'manifest'}`);
  }
  return parsed.hash;
};

const normalizeTargetsPayload = (payload, sourcePath) => {
  const schemaVersion = Number(payload?.schemaVersion);
  if (!Number.isFinite(schemaVersion) || Math.trunc(schemaVersion) !== TUI_TARGETS_SCHEMA_VERSION) {
    throw new Error(
      `unsupported targets schemaVersion in ${sourcePath}: ${payload?.schemaVersion} (expected ${TUI_TARGETS_SCHEMA_VERSION})`
    );
  }
  const rawTargets = Array.isArray(payload?.targets) ? payload.targets : [];
  const targets = rawTargets
    .map(normalizeTargetEntry)
    .filter((entry) => entry.triple && entry.artifactName)
    .sort((a, b) => a.triple.localeCompare(b.triple));
  ensureUniqueTargets(targets, sourcePath);
  return targets;
};

export const resolveTargetsPath = (root) => path.join(root, 'tools', 'tui', 'targets.json');

export const resolveBuildDistDir = ({ root, env = process.env } = {}) => {
  const override = normalizeString(env?.[TUI_BUILD_DIST_DIR_ENV]);
  if (override) return path.resolve(root, override);
  return path.join(root, 'dist', 'tui');
};

export const readTargetsManifestSync = ({ root }) => {
  const targetsPath = resolveTargetsPath(root);
  const payload = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));
  const targets = normalizeTargetsPayload(payload, targetsPath);
  return { targetsPath, schemaVersion: TUI_TARGETS_SCHEMA_VERSION, targets };
};

export const readTargetsManifest = async ({ root }) => {
  const targetsPath = resolveTargetsPath(root);
  const payload = JSON.parse(await fsPromises.readFile(targetsPath, 'utf8'));
  const targets = normalizeTargetsPayload(payload, targetsPath);
  return { targetsPath, schemaVersion: TUI_TARGETS_SCHEMA_VERSION, targets };
};

export const resolveHostTargetTriple = ({ platform = process.platform, arch = os.arch() } = {}) => {
  if (platform === 'win32') {
    if (arch === 'x64') return 'x86_64-pc-windows-msvc';
    if (arch === 'arm64') return 'aarch64-pc-windows-msvc';
  }
  if (platform === 'darwin') {
    if (arch === 'arm64') return 'aarch64-apple-darwin';
    if (arch === 'x64') return 'x86_64-apple-darwin';
  }
  if (platform === 'linux') {
    if (arch === 'x64') return 'x86_64-unknown-linux-gnu';
    if (arch === 'arm64') return 'aarch64-unknown-linux-gnu';
  }
  throw new Error(`unsupported target host: ${platform}/${arch}`);
};

export const resolveTargetForTriple = (targets, triple) => {
  const resolvedTriple = normalizeString(triple);
  if (!resolvedTriple) return null;
  const list = Array.isArray(targets) ? targets : [];
  return list.find((entry) => entry.triple === resolvedTriple) || null;
};

export const resolveTuiInstallLayout = ({ root, triple, artifactName, installRoot = '' }) => {
  const baseInstallRoot = normalizeString(installRoot)
    ? path.resolve(installRoot)
    : path.join(root, '.cache', 'tui', TUI_INSTALL_LAYOUT_DIR);
  const tripleDir = path.join(baseInstallRoot, normalizeString(triple));
  const binDir = path.join(tripleDir, 'bin');
  const logsDir = path.join(tripleDir, 'logs');
  const binaryPath = path.join(binDir, normalizeString(artifactName));
  const metadataPath = path.join(tripleDir, TUI_INSTALL_METADATA_FILE);
  return {
    baseInstallRoot,
    tripleDir,
    binDir,
    logsDir,
    binaryPath,
    metadataPath
  };
};

export const ensureExecutableModeSync = (filePath) => {
  if (process.platform === 'win32') return;
  const stat = fs.statSync(filePath);
  const mode = stat.mode | 0o755;
  fs.chmodSync(filePath, mode);
};

export const isExecutableForPlatform = (stat, platform = process.platform) => {
  if (!stat || typeof stat !== 'object') return false;
  if (!stat.isFile?.()) return false;
  if (platform === 'win32') return true;
  return (stat.mode & 0o111) !== 0;
};

const normalizeBuildManifestArtifact = (entry, root) => ({
  triple: normalizeString(entry?.triple),
  platform: normalizeString(entry?.platform),
  artifactName: normalizeString(entry?.artifactName),
  artifactPath: normalizeString(entry?.artifactPath),
  exists: entry?.exists === true,
  sha256: normalizeString(entry?.sha256).toLowerCase() || null,
  absoluteArtifactPath: normalizeString(entry?.artifactPath)
    ? path.resolve(root, normalizeString(entry?.artifactPath))
    : ''
});

export const readBuildManifestSync = ({ root, verifyChecksum = true }) => {
  const distDir = resolveBuildDistDir({ root });
  const manifestPath = path.join(distDir, TUI_BUILD_MANIFEST_FILE);
  const checksumPath = path.join(distDir, TUI_BUILD_MANIFEST_CHECKSUM_FILE);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`missing build manifest: ${toPosixRelative(root, manifestPath)}`);
  }
  const body = fs.readFileSync(manifestPath, 'utf8');
  const manifestChecksum = verifyChecksum
    ? verifyTextChecksumFile({
      body,
      checksumFilePath: checksumPath,
      expectedFileName: TUI_BUILD_MANIFEST_FILE
    })
    : sha256Text(body);
  const payload = JSON.parse(body);
  const targetsManifest = payload?.targetsManifest && typeof payload.targetsManifest === 'object'
    ? {
      file: normalizeString(payload.targetsManifest.file),
      sha256: normalizeString(payload.targetsManifest.sha256).toLowerCase() || null
    }
    : { file: '', sha256: null };
  const artifacts = (Array.isArray(payload?.artifacts) ? payload.artifacts : [])
    .map((entry) => normalizeBuildManifestArtifact(entry, root))
    .filter((entry) => entry.triple && entry.artifactName && entry.artifactPath)
    .sort((a, b) => a.triple.localeCompare(b.triple));
  ensureUniqueTargets(artifacts, manifestPath);
  return {
    manifestPath,
    checksumPath,
    manifestChecksum,
    schemaVersion: Number(payload?.schemaVersion) || 0,
    mode: normalizeString(payload?.mode),
    pathPolicy: normalizeString(payload?.pathPolicy),
    targetsManifest,
    artifacts
  };
};

export const writeStableJsonFile = async (filePath, payload) => {
  const body = `${stableStringify(payload)}\n`;
  await fsPromises.writeFile(filePath, body, 'utf8');
  return body;
};
