#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const root = process.cwd();
const scriptPath = path.join(root, 'tools', 'setup', 'postinstall.js');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-postinstall-rebuild-'));
const markerPath = path.join(tempRoot, 'rebuild-ran.txt');

try {
  await fs.mkdir(path.join(tempRoot, 'patches'), { recursive: true });
  await fs.mkdir(path.join(tempRoot, 'node_modules', '.bin'), { recursive: true });
  await fs.mkdir(path.join(tempRoot, 'tools', 'setup'), { recursive: true });
  await fs.writeFile(path.join(tempRoot, 'patches', 'sample+1.0.0.patch'), 'diff --git a/x b/x\n');

  const patchPackageBin = process.platform === 'win32'
    ? path.join(tempRoot, 'node_modules', '.bin', 'patch-package.cmd')
    : path.join(tempRoot, 'node_modules', '.bin', 'patch-package');
  const patchPackageScript = process.platform === 'win32'
    ? '@echo off\r\nexit /b 0\r\n'
    : '#!/usr/bin/env sh\nexit 0\n';
  await fs.writeFile(patchPackageBin, patchPackageScript, 'utf8');
  if (process.platform !== 'win32') {
    await fs.chmod(patchPackageBin, 0o755);
  }

  const rebuildScriptPath = path.join(tempRoot, 'tools', 'setup', 'rebuild-native.js');
  await fs.writeFile(
    rebuildScriptPath,
    `#!/usr/bin/env node
import fs from 'node:fs';
fs.writeFileSync(${JSON.stringify(markerPath)}, 'ran', 'utf8');
`,
    'utf8'
  );

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: tempRoot,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, `postinstall should succeed, got ${result.status}`);

  const marker = await fs.readFile(markerPath, 'utf8');
  assert.equal(marker, 'ran');

  console.log('postinstall rebuild native contract test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
