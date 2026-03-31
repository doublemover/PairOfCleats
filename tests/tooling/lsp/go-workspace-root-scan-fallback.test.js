#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveGoWorkspaceModulePreflight } from '../../../src/index/tooling/preflight/go-workspace-preflight.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `gopls-root-scan-fallback-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'services', 'api'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'docs'), { recursive: true });

await fs.writeFile(
  path.join(tempRoot, 'services', 'api', 'go.mod'),
  'module example.com/api\n\ngo 1.22\n',
  'utf8'
);
await fs.writeFile(
  path.join(tempRoot, 'docs', 'sample.go'),
  'package docs\n\nfunc Sample() {}\n',
  'utf8'
);

const probePath = path.join(tempRoot, 'go-module-probe.js');
await fs.writeFile(
  probePath,
  [
    "const cwd = process.cwd().replace(/\\\\/g, '/');",
    "if (!cwd.endsWith('/services/api')) {",
    "  process.stderr.write(`unexpected cwd ${cwd}\\n`);",
    '  process.exit(19);',
    '}',
    "process.stdout.write('example.com/api\\n');"
  ].join('\n'),
  'utf8'
);

const result = await resolveGoWorkspaceModulePreflight({
  ctx: {
    repoRoot: tempRoot,
    cache: { dir: null },
    logger: () => {}
  },
  server: {
    id: 'gopls',
    cmd: 'gopls',
    languages: ['go'],
    goWorkspaceModuleCmd: process.execPath,
    goWorkspaceModuleArgs: [probePath],
    goWorkspaceWarmup: false
  },
  documents: [{
    virtualPath: '.poc-vfs/docs/sample.go#seg:gopls-root-scan-fallback.txt',
    path: '.poc-vfs/docs/sample.go#seg:gopls-root-scan-fallback.txt',
    languageId: 'go'
  }]
});

assert.equal(result?.state, 'ready', 'expected nested Go workspace root to be narrowed instead of blocked');
assert.equal(result?.reasonCode, null, 'expected narrowed nested root to avoid blocked reason codes');
assert.equal(
  Array.isArray(result?.checks) && result.checks.some((check) => check?.name === 'go_workspace_root_scan_narrowed'),
  true,
  'expected narrowed root advisory check'
);

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('go workspace root scan fallback test passed');
