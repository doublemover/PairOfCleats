#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveGoWorkspaceModulePreflight } from '../../../src/index/tooling/preflight/go-workspace-preflight.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `gopls-managed-go-resolution-${process.pid}-${Date.now()}`);
const toolingRoot = path.join(tempRoot, 'tooling-root');
const toolingBinDir = path.join(toolingRoot, 'bin');
const logPath = path.join(toolingBinDir, 'go-invocations.log');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.mkdir(toolingBinDir, { recursive: true });
await fs.writeFile(
  path.join(tempRoot, 'go.mod'),
  'module example.com/managed-go-resolution\n\ngo 1.22\n',
  'utf8'
);
await fs.writeFile(
  path.join(tempRoot, 'src', 'sample.go'),
  'package main\n\nfunc Sample() int { return 1 }\n',
  'utf8'
);

const helperPath = path.join(toolingBinDir, 'go-helper.js');
await fs.writeFile(
  helperPath,
  [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "const logPath = process.argv[2];",
    'const args = process.argv.slice(3);',
    "fs.appendFileSync(logPath, `${JSON.stringify(args)}\\n`, 'utf8');",
    "if (args[0] === 'version') {",
    "  process.stdout.write('go version go1.22.0 managed/test\\n');",
    '  process.exit(0);',
    '}',
    "if (args[0] === 'help') {",
    "  process.stdout.write('Go help\\n');",
    '  process.exit(0);',
    '}',
    "if (args[0] === 'list' && args[1] === '-m') {",
    "  process.stdout.write('example.com/managed-go-resolution\\n');",
    '  process.exit(0);',
    '}',
    "if (args[0] === 'list' && args[1] === './...') {",
    "  process.stdout.write('example.com/managed-go-resolution\\n');",
    '  process.exit(0);',
    '}',
    "process.stderr.write(`unexpected go invocation: ${args.join(' ')}\\n`);",
    'process.exit(19);'
  ].join('\n'),
  'utf8'
);

if (process.platform === 'win32') {
  await fs.writeFile(
    path.join(toolingBinDir, 'go.cmd'),
    `@echo off\r\n"${process.execPath}" "%~dp0\\go-helper.js" "%~dp0\\go-invocations.log" %*\r\n`,
    'utf8'
  );
} else {
  await fs.writeFile(
    path.join(toolingBinDir, 'go'),
    `#!/bin/sh\n'${process.execPath}' "$(dirname "$0")/go-helper.js" "$(dirname "$0")/go-invocations.log" "$@"\n`,
    'utf8'
  );
  await fs.chmod(path.join(toolingBinDir, 'go'), 0o755);
}

await withTemporaryEnv({
  PATH: path.dirname(process.execPath),
  Path: path.dirname(process.execPath)
}, async () => {
  const result = await resolveGoWorkspaceModulePreflight({
    ctx: {
      repoRoot: tempRoot,
      toolingConfig: { dir: toolingRoot },
      cache: { dir: null },
      logger: () => {}
    },
    server: {
      id: 'gopls',
      cmd: 'gopls',
      languages: ['go'],
      goWorkspaceWarmup: true,
      goWorkspaceWarmupMinGoFiles: 1
    },
    documents: [{
      virtualPath: '.poc-vfs/src/sample.go#seg:gopls-managed-go-resolution.txt',
      path: '.poc-vfs/src/sample.go#seg:gopls-managed-go-resolution.txt',
      languageId: 'go'
    }]
  });

  assert.equal(result?.state, 'ready', 'expected managed local go shim to satisfy workspace preflight');
  assert.equal(result?.reasonCode, null, 'expected managed local go shim to avoid blocked workspace reason codes');
});

const invocations = (await fs.readFile(logPath, 'utf8'))
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => JSON.parse(line));

assert.equal(
  invocations.some((args) => Array.isArray(args) && args[0] === 'list' && args[1] === '-m'),
  true,
  'expected module probe to run through managed go shim'
);
assert.equal(
  invocations.some((args) => Array.isArray(args) && args[0] === 'list' && args[1] === './...'),
  true,
  'expected warmup probe to run through managed go shim'
);

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('go workspace managed go resolution test passed');
