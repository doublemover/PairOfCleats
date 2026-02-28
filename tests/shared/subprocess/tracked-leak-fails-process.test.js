#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { killProcessTree } from '../../helpers/kill-tree.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testLogs', `tracked-leak-fails-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const pidFile = path.join(tempRoot, 'leaked-child.pid');
const scriptPath = path.join(tempRoot, 'spawn-leak.mjs');
const subprocessModuleHref = pathToFileURL(path.join(root, 'src', 'shared', 'subprocess.js')).href;
const scriptBody = [
  "import fs from 'node:fs';",
  "import { spawn } from 'node:child_process';",
  `import { registerChildProcessForCleanup } from '${subprocessModuleHref}';`,
  `const pidFile = process.argv[2];`,
  "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60_000);'], {",
  "  stdio: 'ignore',",
  "  detached: process.platform !== 'win32'",
  "});",
  "registerChildProcessForCleanup(child, {",
  "  killTree: true,",
  "  detached: process.platform !== 'win32',",
  "  name: 'tracked-leak-fixture-child'",
  "});",
  "try { fs.writeFileSync(pidFile, String(child.pid || '')); } catch {}",
  'setTimeout(() => process.exit(0), 30);'
].join('\n');
await fs.writeFile(scriptPath, scriptBody, 'utf8');

let leakedPid = null;
try {
  const helperImport = pathToFileURL(path.join(root, 'tests', 'helpers', 'test-env.js')).href;
  const inheritedNodeOptions = String(process.env.NODE_OPTIONS || '').trim();
  const mergedNodeOptions = inheritedNodeOptions
    ? `${inheritedNodeOptions} --import ${helperImport}`
    : `--import ${helperImport}`;
  const result = spawnSync(
    process.execPath,
    [scriptPath, pidFile],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        NODE_OPTIONS: mergedNodeOptions
      }
    }
  );
  assert.equal(result.status, 1, `expected leak fixture process to fail (status=${result.status ?? 'null'})`);
  const stderr = String(result.stderr || '');
  assert.equal(
    stderr.includes('[test-cleanup][leak') || stderr.includes('[test-cleanup][leak-sync]'),
    true,
    'expected leak fixture process to emit test-cleanup leak marker'
  );
} finally {
  try {
    leakedPid = Number(String(await fs.readFile(pidFile, 'utf8')).trim());
  } catch {}
  if (Number.isFinite(leakedPid) && leakedPid > 0) {
    await killProcessTree(leakedPid, { graceMs: 0 });
  }
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('tracked subprocess leak fail-on-cleanup test passed');
