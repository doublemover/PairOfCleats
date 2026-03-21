#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveHostTargetTriple } from '../../../tools/tui/targets.js';

const root = process.cwd();
const binPath = path.join(root, 'bin', 'pairofcleats.js');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-cli-tui-install-missing-cargo-'));
const distDir = path.join(tempRoot, 'dist');
const installRoot = path.join(tempRoot, 'install');
const triple = resolveHostTargetTriple({ platform: process.platform, arch: os.arch() });

const env = applyTestEnv({
  syncProcess: false,
  extraEnv: {
    PAIROFCLEATS_TUI_CARGO: path.join(tempRoot, 'missing-cargo.exe'),
    PAIROFCLEATS_TUI_DIST_DIR: distDir
  }
});

const result = spawnSync(
  process.execPath,
  [binPath, 'tui', 'install', '--target', triple, '--install-root', installRoot],
  {
    cwd: root,
    encoding: 'utf8',
    env
  }
);

assert.notEqual(result.status, 0, 'expected tui install to fail when cargo is unavailable and no staged artifact exists');
assert.match(result.stderr || '', /failed to spawn cargo/i);
assert.match(result.stderr || '', /PAIROFCLEATS_TUI_CARGO/);

console.log('tui install missing cargo test passed');
