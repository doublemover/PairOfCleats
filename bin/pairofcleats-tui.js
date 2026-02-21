#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getTuiEnvConfig } from '../src/shared/env.js';
import {
  isExecutableForPlatform,
  readBuildManifestSync,
  readTargetsManifestSync,
  resolveHostTargetTriple,
  resolveTargetForTriple,
  resolveTuiInstallLayout,
  sha256FileSync,
  toPosixRelative
} from '../tools/tui/targets.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tuiEnvConfig = getTuiEnvConfig(process.env);
const installRootOverride = tuiEnvConfig.installRoot;

const fail = (message, hints = []) => {
  console.error(`[tui] ${message}`);
  for (const hint of hints) {
    console.error(`hint: ${hint}`);
  }
  process.exit(1);
};

const parseInstallMetadata = (metadataPath) => {
  if (!fs.existsSync(metadataPath)) {
    fail(`missing install manifest: ${toPosixRelative(root, metadataPath)}`, [
      'run `pairofcleats tui install` to install the current target binary',
      'if you use a custom install directory, set PAIROFCLEATS_TUI_INSTALL_ROOT'
    ]);
  }
  let payload = null;
  try {
    payload = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch {
    fail(`invalid install manifest JSON: ${toPosixRelative(root, metadataPath)}`, [
      'run `pairofcleats tui install --json` to rebuild install metadata'
    ]);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    fail(`invalid install manifest payload: ${toPosixRelative(root, metadataPath)}`);
  }
  return payload;
};

const resolveBuildChecksum = ({ triple }) => {
  try {
    const manifest = readBuildManifestSync({ root, verifyChecksum: true });
    const artifact = resolveTargetForTriple(manifest.artifacts, triple);
    return artifact?.sha256 || null;
  } catch {
    return null;
  }
};

const resolveRuntime = () => {
  const { targets } = readTargetsManifestSync({ root });
  const triple = resolveHostTargetTriple({ platform: process.platform, arch: os.arch() });
  const target = resolveTargetForTriple(targets, triple);
  if (!target) {
    fail(`unsupported target: ${triple}`, ['update tools/tui/targets.json to include this host triple']);
  }

  const layout = resolveTuiInstallLayout({
    root,
    triple,
    artifactName: target.artifactName,
    installRoot: installRootOverride
  });
  const metadata = parseInstallMetadata(layout.metadataPath);
  if (String(metadata?.triple || '') !== triple) {
    fail(`install manifest target mismatch: expected ${triple}, got ${String(metadata?.triple || '(missing)')}`, [
      `run \`pairofcleats tui install --target ${triple}\``
    ]);
  }
  if (String(metadata?.artifactName || '') !== target.artifactName) {
    fail(
      `install manifest artifact mismatch: expected ${target.artifactName}, got ${String(metadata?.artifactName || '(missing)')}`,
      ['run `pairofcleats tui install` to refresh installed binary metadata']
    );
  }

  const binaryPath = layout.binaryPath;
  if (!fs.existsSync(binaryPath)) {
    fail(`missing installed TUI binary: ${toPosixRelative(root, binaryPath)}`, [
      'run `pairofcleats tui install` to install the binary'
    ]);
  }

  const stat = fs.statSync(binaryPath);
  if (!isExecutableForPlatform(stat, process.platform)) {
    fail(`installed binary is not executable: ${toPosixRelative(root, binaryPath)}`, [
      'run `pairofcleats tui install` to repair executable metadata'
    ]);
  }

  const actualSha = sha256FileSync(binaryPath);
  const expectedInstallSha = String(metadata?.binary?.sha256 || '').trim().toLowerCase();
  if (!expectedInstallSha || expectedInstallSha !== actualSha) {
    fail(`installed binary checksum mismatch for ${toPosixRelative(root, binaryPath)}`, [
      'run `pairofcleats tui install` to reinstall and refresh checksum metadata'
    ]);
  }

  const expectedBuildSha = resolveBuildChecksum({ triple });
  if (expectedBuildSha && expectedBuildSha !== actualSha) {
    fail(`installed binary checksum does not match current build manifest for ${triple}`, [
      'run `pairofcleats tui build --smoke`',
      'run `pairofcleats tui install`'
    ]);
  }

  const eventLogDir = String(metadata?.observability?.eventLogDir || '').trim()
    ? path.resolve(root, String(metadata.observability.eventLogDir))
    : layout.logsDir;
  fs.mkdirSync(eventLogDir, { recursive: true });
  return { binaryPath, eventLogDir };
};

const { binaryPath, eventLogDir } = resolveRuntime();
const args = process.argv.slice(2);
const runId = tuiEnvConfig.runId
  || `tui-${Date.now().toString(36)}-${process.pid}`;
const env = {
  ...process.env,
  PAIROFCLEATS_TUI_RUN_ID: runId,
  PAIROFCLEATS_TUI_EVENT_LOG_DIR: tuiEnvConfig.eventLogDir || eventLogDir
};
const result = spawnSync(binaryPath, args, { stdio: 'inherit', env });
process.exit(result.status ?? 1);
