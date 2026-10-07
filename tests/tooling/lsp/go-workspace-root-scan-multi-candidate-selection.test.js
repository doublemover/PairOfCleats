#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveGoWorkspaceModulePreflight } from '../../../src/index/tooling/preflight/go-workspace-preflight.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `gopls-root-scan-multi-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });

const writeProbe = async (targetRootRel, scriptName) => {
  const probePath = path.join(tempRoot, scriptName);
  await fs.writeFile(
    probePath,
    [
      "const cwd = process.cwd().replace(/\\\\/g, '/');",
      `if (!cwd.endsWith('/${targetRootRel.replace(/\\/g, '/')}')) {`,
      "  process.stderr.write(`unexpected cwd ${cwd}\\n`);",
      '  process.exit(19);',
      '}',
      "process.stdout.write('ok\\n');"
    ].join('\n'),
    'utf8'
  );
  return probePath;
};

await fs.mkdir(path.join(tempRoot, 'examples', 'go'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'tools', 'lint'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'examples', 'docs'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'examples', 'go', 'go.mod'), 'module example.com/examples\n\ngo 1.22\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'tools', 'lint', 'go.mod'), 'module example.com/lint\n\ngo 1.22\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'examples', 'docs', 'sample.go'), 'package docs\n\nfunc Sample() {}\n', 'utf8');

const uniqueProbePath = await writeProbe('examples/go', 'go-module-probe-unique.js');
const uniqueResult = await resolveGoWorkspaceModulePreflight({
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
    goWorkspaceModuleArgs: [uniqueProbePath],
    goWorkspaceWarmup: false
  },
  documents: [{
    virtualPath: '.poc-vfs/examples/docs/sample.go#seg:gopls-root-scan-multi-unique.txt',
    path: '.poc-vfs/examples/docs/sample.go#seg:gopls-root-scan-multi-unique.txt',
    languageId: 'go'
  }]
});

assert.equal(uniqueResult?.state, 'ready', 'expected unique nearest nested root to be selected');
assert.equal(uniqueResult?.reasonCode, null, 'expected unique nearest nested root to avoid blocked reason');
assert.equal(
  Array.isArray(uniqueResult?.checks) && uniqueResult.checks.some((check) => check?.name === 'go_workspace_root_scan_narrowed'),
  true,
  'expected narrowed-root advisory check for multi-root selection'
);

await fs.mkdir(path.join(tempRoot, 'services', 'api'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'services', 'worker'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'services', 'docs'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'services', 'api', 'go.mod'), 'module example.com/api\n\ngo 1.22\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'services', 'worker', 'go.mod'), 'module example.com/worker\n\ngo 1.22\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'services', 'docs', 'sample.go'), 'package docs\n\nfunc Sample() {}\n', 'utf8');

const ambiguousResult = await resolveGoWorkspaceModulePreflight({
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
    goWorkspaceModuleArgs: ['-e', "process.stdout.write('should not run\\n');"],
    goWorkspaceWarmup: false
  },
  documents: [{
    virtualPath: '.poc-vfs/services/docs/sample.go#seg:gopls-root-scan-multi-ambiguous.txt',
    path: '.poc-vfs/services/docs/sample.go#seg:gopls-root-scan-multi-ambiguous.txt',
    languageId: 'go'
  }]
});

assert.equal(ambiguousResult?.state, 'blocked', 'expected equal-prefix nested roots to remain blocked');
assert.equal(
  ambiguousResult?.reasonCode,
  'go_workspace_blocked_workspace_shape',
  'expected equal-prefix nested roots to keep workspace-shape blocked reason'
);

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('go workspace root scan multi-candidate selection test passed');
