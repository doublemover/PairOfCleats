import path from 'node:path';
import fs from 'node:fs';

import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

export const runToolingInstallWithEmptyPath = (toolId, { failInstaller = false } = {}) => {
  const root = process.cwd();
  const fixtureRoot = path.join(root, 'tests', 'fixtures', 'languages');
  const scriptPath = path.join(root, 'tools', 'tooling', 'install.js');
  const fixtureBase = resolveTestCachePath(root, 'tooling-install-requirements');
  fs.mkdirSync(fixtureBase, { recursive: true });
  const fixtureDir = fs.mkdtempSync(path.join(fixtureBase, `${toolId}-`));
  const binDir = path.join(fixtureDir, 'bin');
  const toolingDir = path.join(fixtureDir, 'tooling');
  const installerMarker = path.join(fixtureDir, 'installer-called');
  fs.mkdirSync(binDir);
  if (failInstaller) {
    const command = path.join(binDir, process.platform === 'win32' ? 'npm.cmd' : 'npm');
    fs.writeFileSync(command, process.platform === 'win32'
      ? `@echo off\r\nif "%1"=="--version" (echo 11.0.0&exit /b 0)\r\necho called>"${installerMarker}"\r\nexit /b 23\r\n`
      : `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 11.0.0; exit 0; fi\nprintf called > '${installerMarker.replace(/'/g, `'\\''`)}'\nexit 23\n`);
    if (process.platform !== 'win32') fs.chmodSync(command, 0o755);
  }
  if (toolId === 'gopls') {
    // A present but invalid Go command exercises the structured requirement
    // check. An unverified disposable SDK pointer makes fallback fail locally,
    // without a network download or touching the user's managed tool cache.
    if (process.platform === 'win32') fs.linkSync(process.execPath, path.join(binDir, 'go.exe'));
    else {
      const command = path.join(binDir, 'go');
      fs.writeFileSync(command, '#!/bin/sh\nprintf "not-a-go-sdk\\n"\n');
      fs.chmodSync(command, 0o755);
    }
    const sdkDir = path.join(toolingDir, 'sdk', 'go');
    fs.mkdirSync(sdkDir, { recursive: true });
    fs.writeFileSync(path.join(sdkDir, 'current.json'), '{"unverified":true}\n');
  }
  const env = applyTestEnv({
    cacheRoot: fixtureDir,
    testConfig: { tooling: { dir: toolingDir } },
    extraEnv: {
      PATH: binDir,
      Path: binDir,
      PAIROFCLEATS_TOOLING_DIR: toolingDir,
      PAIROFCLEATS_HOME: path.join(fixtureDir, 'home'),
      ...(toolId === 'gopls' ? { GOROOT: fixtureDir, GOTOOLCHAIN: 'local' } : {}),
      PAIROFCLEATS_TRUSTED_CONFIG: null
    },
    syncProcess: false
  });

  let result, installerCalled = false;
  try {
    result = runNode(
      [scriptPath, '--root', fixtureRoot, '--tools', toolId, '--scope', 'user', '--json'],
      `tooling install isolated requirement ${toolId}`,
      root,
      env,
      { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 }
    );
    installerCalled = fs.existsSync(installerMarker);
  } finally { fs.rmSync(fixtureDir, { recursive: true, force: true }); }

  let payload = null;
  try {
    payload = JSON.parse(String(result.stdout || '{}'));
  } catch {
    throw new Error('tooling-install helper failed: stdout was not valid JSON');
  }

  return { result, payload, installerCalled };
};
