#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { detectTool, getToolingRegistry } from '../../../tools/tooling/utils.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testLogs', `tooling-detect-pyright-path-${process.pid}-${Date.now()}`);
const binDir = path.join(tempRoot, 'bin');
const toolingRoot = path.join(tempRoot, 'tooling-root');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(binDir, { recursive: true });
await fs.mkdir(toolingRoot, { recursive: true });

if (process.platform === 'win32') {
  await fs.writeFile(
    path.join(binDir, 'pyright-langserver.cmd'),
    '@echo off\r\nif "%1"=="--help" exit /b 0\r\nexit /b 0\r\n',
    'utf8'
  );
} else {
  const scriptPath = path.join(binDir, 'pyright-langserver');
  await fs.writeFile(scriptPath, '#!/usr/bin/env sh\nexit 0\n', 'utf8');
  await fs.chmod(scriptPath, 0o755);
}

const registry = getToolingRegistry(toolingRoot, root);
const pyright = registry.find((entry) => entry?.id === 'pyright');
assert.ok(pyright, 'expected pyright entry in tooling registry');
const pyrightPathOnly = {
  ...pyright,
  detect: {
    ...(pyright.detect || {}),
    binDirs: []
  }
};

await withTemporaryEnv(
  {
    PATH: '',
    Path: binDir
  },
  async () => {
    const status = detectTool(pyrightPathOnly);
    assert.equal(status?.found, true, 'expected pyright detection to use Path fallback when PATH is empty');
    assert.equal(status?.source, 'path', 'expected pyright detection source=path');
    assert.ok(String(status?.path || '').toLowerCase().includes('pyright-langserver'), 'expected pyright binary path');
  }
);

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('tooling detect pyright Path fallback test passed');
