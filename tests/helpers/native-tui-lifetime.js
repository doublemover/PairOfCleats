import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSubprocess } from '../../src/shared/subprocess/runner.js';

export const verifyNativeTuiLifetime = async mode => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const result = await spawnSubprocess('python3', [path.join(root, 'tests/fixtures/tui/native-lifetime-pty.py'),
    root, process.execPath, mode], { cwd: root, timeoutMs: 26000, maxOutputBytes: 65536 });
  assert.equal(result.exitCode, 0, result.stderr);
  const receipt = JSON.parse(result.stdout.trim());
  assert.equal(receipt.mode, mode);
  assert.equal(receipt.allReaped, true);
  assert.equal(receipt.terminalRestored, true);
  console.log(`native TUI ${mode} lifetime test passed: ${JSON.stringify(receipt)}`);
};
