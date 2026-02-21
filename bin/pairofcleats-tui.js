#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const resolveTriple = () => {
  if (process.platform === 'win32') return 'x86_64-pc-windows-msvc';
  if (process.platform === 'darwin') {
    return os.arch() === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  }
  return 'x86_64-unknown-linux-gnu';
};

const triple = resolveTriple();
const targetsPath = path.join(root, 'tools', 'tui', 'targets.json');
let artifactName = '';
try {
  const payload = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));
  const targets = Array.isArray(payload?.targets) ? payload.targets : [];
  const target = targets.find((entry) => String(entry?.triple || '') === triple);
  artifactName = String(target?.artifactName || '');
} catch {}

if (!artifactName) {
  console.error(`[tui] Unsupported target: ${triple}`);
  process.exit(1);
}

const binaryPath = path.join(root, '.cache', 'tui', triple, artifactName);
if (!fs.existsSync(binaryPath)) {
  console.error(`[tui] Missing TUI binary: ${binaryPath}`);
  console.error('hint: run `pairofcleats tui install` to install the local TUI binary.');
  process.exit(1);
}

const args = process.argv.slice(2);
const result = spawnSync(binaryPath, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
