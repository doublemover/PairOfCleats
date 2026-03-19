#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  assertPinnedPackagingToolchain,
  buildDeterministicZip,
  writeArchiveChecksums
} from './tooling/archive-determinism.js';
import { getEditorCommandSpecs } from '../src/shared/runtime-capability-manifest.js';

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const readOption = (name, fallback = '') => {
  const flag = `--${name}`;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === flag) {
      const next = args[i + 1];
      return typeof next === 'string' ? next : fallback;
    }
    if (typeof arg === 'string' && arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1);
    }
  }
  return fallback;
};

if (hasFlag('--help') || hasFlag('-h')) {
  console.error('Usage: node tools/package-vscode.js [--out-dir <dir>] [--smoke]');
  process.exit(0);
}

const root = process.cwd();
const sourceDir = path.join(root, 'extensions', 'vscode');
const outDir = path.resolve(root, readOption('out-dir', path.join('dist', 'vscode')));
const archivePath = path.join(outDir, 'pairofcleats.vsix');
const checksumPath = `${archivePath}.sha256`;
const manifestPath = `${archivePath}.manifest.json`;
const smoke = hasFlag('--smoke');

const probeNpm = () => {
  if (process.platform === 'win32') {
    const probe = spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm --version'], { encoding: 'utf8' });
    if (probe.status === 0) {
      return { ok: true, command: 'npm' };
    }
    return { ok: false, command: null };
  }
  const probe = spawnSync('npm', ['--version'], { encoding: 'utf8' });
  if (probe.status === 0) {
    return { ok: true, command: 'npm' };
  }
  return { ok: false, command: null };
};

if (!fs.existsSync(sourceDir)) {
  console.error(`VS Code package source not found: ${sourceDir}`);
  process.exit(1);
}
if (!fs.existsSync(path.join(sourceDir, 'package.json'))) {
  console.error('VS Code package source missing package.json.');
  process.exit(1);
}
if (!fs.existsSync(path.join(sourceDir, 'extension.js'))) {
  console.error('VS Code package source missing extension.js.');
  process.exit(1);
}
const readmePath = path.join(sourceDir, 'README.md');
if (!fs.existsSync(readmePath)) {
  console.error('VS Code package source missing README.md.');
  process.exit(1);
}

let packageManifest = null;
try {
  packageManifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'package.json'), 'utf8'));
} catch (err) {
  console.error(`VS Code package manifest is invalid JSON: ${err?.message || String(err)}`);
  process.exit(1);
}

const requiredManifestFields = [
  ['name', packageManifest.name],
  ['displayName', packageManifest.displayName],
  ['description', packageManifest.description],
  ['version', packageManifest.version],
  ['publisher', packageManifest.publisher],
  ['homepage', packageManifest.homepage],
  ['repository.url', packageManifest.repository?.url],
  ['bugs.url', packageManifest.bugs?.url],
  ['engines.vscode', packageManifest.engines?.vscode]
];
for (const [label, value] of requiredManifestFields) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    console.error(`VS Code package manifest missing required field ${label}.`);
    process.exit(1);
  }
}
if (packageManifest.capabilities?.virtualWorkspaces !== false) {
  console.error('VS Code package manifest must declare capabilities.virtualWorkspaces=false.');
  process.exit(1);
}
const expectedEditorCommands = new Map(getEditorCommandSpecs().map((entry) => [entry.id, entry.title]));
const activationEvents = new Set(packageManifest.activationEvents || []);
for (const [commandId, title] of expectedEditorCommands.entries()) {
  if (!activationEvents.has(`onCommand:${commandId}`)) {
    console.error(`VS Code package manifest missing activation event for ${commandId}.`);
    process.exit(1);
  }
  const command = (packageManifest.contributes?.commands || []).find((entry) => entry.command === commandId);
  if (!command) {
    console.error(`VS Code package manifest missing command ${commandId}.`);
    process.exit(1);
  }
  if (command.title !== title) {
    console.error(`VS Code package manifest title drifted for ${commandId}.`);
    process.exit(1);
  }
}

for (const walkthrough of packageManifest.contributes?.walkthroughs || []) {
  for (const step of walkthrough.steps || []) {
    const markdown = step?.media?.markdown;
    if (typeof markdown !== 'string' || markdown.trim().length === 0) {
      console.error(`VS Code walkthrough ${step?.id || '<unknown>'} missing markdown media.`);
      process.exit(1);
    }
    const markdownPath = path.join(sourceDir, markdown);
    if (!fs.existsSync(markdownPath)) {
      console.error(`VS Code walkthrough markdown missing: ${markdown}`);
      process.exit(1);
    }
  }
}

try {
  assertPinnedPackagingToolchain({ requireNpm: true });
  const npmProbe = probeNpm();
  if (!npmProbe.ok) {
    throw new Error('Packaging toolchain error: npm is required for VS Code packaging.');
  }
} catch (err) {
  console.error(err?.message || String(err));
  process.exit(1);
}

const built = await buildDeterministicZip({
  sourceDir,
  archivePath,
  rootPrefix: 'extension'
});

const manifest = await writeArchiveChecksums({
  archivePath,
  checksum: built.checksum,
  entries: built.entries,
  checksumPath,
  manifestPath,
  toolchain: {
    node: process.versions.node,
    npmRequired: true,
    archive: 'vsix(zip)'
  }
});

if (smoke) {
  if (!fs.existsSync(archivePath)) {
    console.error('VS Code smoke packaging failed: archive not created.');
    process.exit(1);
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    console.error('VS Code smoke packaging failed: manifest entries missing.');
    process.exit(1);
  }
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  archive: path.relative(root, archivePath).replace(/\\/g, '/'),
  checksum: built.checksum,
  entries: built.entries.length
})}\n`);
