#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const outA = path.join(root, '.testCache', 'package-sublime-determinism-a');
const outB = path.join(root, '.testCache', 'package-sublime-determinism-b');

const runPack = (outDir) => spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'package-sublime.js'), '--out-dir', outDir],
  { cwd: root, encoding: 'utf8' }
);

const first = runPack(outA);
if (first.status !== 0) {
  console.error('package-determinism test failed: first package run failed');
  process.exit(first.status ?? 1);
}
const second = runPack(outB);
if (second.status !== 0) {
  console.error('package-determinism test failed: second package run failed');
  process.exit(second.status ?? 1);
}

const checksumA = fs.readFileSync(path.join(outA, 'pairofcleats.sublime-package.sha256'), 'utf8').trim();
const checksumB = fs.readFileSync(path.join(outB, 'pairofcleats.sublime-package.sha256'), 'utf8').trim();
if (checksumA !== checksumB) {
  console.error('package-determinism test failed: checksum mismatch across runs');
  process.exit(1);
}

console.log('sublime package determinism test passed');
