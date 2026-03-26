import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readJsonFile } from '../../src/shared/json-file.js';
import { runNode } from './run-node.js';
import { applyTestEnv } from './test-env.js';

export async function createJsonGateHarness({
  rootDir = process.cwd(),
  scriptPath,
  scriptRelativePath = null,
  tempPrefix = 'pairofcleats-json-gate-',
  tempRoot = null,
  jsonFileName = 'gate.json',
  env = null,
  cwd = rootDir
} = {}) {
  const resolvedScriptPath = scriptPath || path.join(rootDir, scriptRelativePath || '');
  const resolvedTempRoot = tempRoot || await fs.mkdtemp(path.join(os.tmpdir(), tempPrefix));
  const jsonPath = path.join(resolvedTempRoot, jsonFileName);
  const runtimeEnv = env || applyTestEnv({ syncProcess: false });

  return {
    rootDir,
    cwd,
    env: runtimeEnv,
    scriptPath: resolvedScriptPath,
    tempRoot: resolvedTempRoot,
    jsonPath,
    run(args = [], {
      label = path.basename(resolvedScriptPath),
      allowFailure = false,
      cwdOverride = cwd
    } = {}) {
      return runNode(
        [resolvedScriptPath, ...args, '--json', jsonPath],
        label,
        cwdOverride,
        runtimeEnv,
        { encoding: 'utf8', allowFailure, stdio: 'pipe' }
      );
    },
    async readPayload() {
      return await readJsonFile(jsonPath);
    },
    async cleanup() {
      await fs.rm(resolvedTempRoot, { recursive: true, force: true });
    }
  };
}
