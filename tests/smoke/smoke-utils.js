import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { runNode as runNodeHelper } from '../helpers/run-node.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';
import { RETRYABLE_RM_CODES, rmDirRecursive } from '../helpers/temp.js';

export const root = process.cwd();

export async function cleanup(paths) {
  for (const dir of paths) {
    try {
      const removed = await rmDirRecursive(dir, {
        retries: 10,
        delayMs: 100,
        ignoreRetryableFailure: true
      });
      if (!removed) {
        console.warn(`Cleanup warning (ignored): retryable failure while removing ${dir}`);
      }
    } catch (err) {
      if (RETRYABLE_RM_CODES.has(err?.code)) {
        console.warn(`Cleanup warning (ignored): ${err.code} while removing ${dir}`);
        continue;
      }
      throw err;
    }
  }
}

export function runNode(label, scriptPath, args = [], options = {}) {
  const {
    cwd = root,
    env = process.env,
    stdio = 'inherit',
    timeout,
    ...spawnOptions
  } = options;
  const result = runNodeHelper([scriptPath, ...args], label, cwd, env, {
    stdio,
    timeoutMs: timeout,
    allowFailure: true,
    spawnOptions
  });
  if (result.status !== 0) {
    const error = new Error(`Failed: ${label}`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
  return result;
}

export const createSmokeIndexFixture = async ({
  name,
  token,
  testConfig = {},
  embeddings = 'stub'
}) => {
  const tempRoot = resolveTestCachePath(root, name);
  const repoRoot = path.join(tempRoot, 'repo');
  const cacheRoot = path.join(tempRoot, 'cache');
  const env = applyTestEnv({
    cacheRoot,
    embeddings,
    testConfig: {
      indexing: {
        typeInference: false,
        typeInferenceCrossFile: false,
        riskAnalysis: false,
        riskAnalysisCrossFile: false,
        scm: { provider: 'none' }
      },
      tooling: {
        autoEnableOnDetect: false,
        lsp: { enabled: false }
      },
      ...testConfig
    }
  });

  await cleanup([tempRoot]);
  await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });
  await fsPromises.writeFile(
    path.join(repoRoot, 'src', 'alpha.js'),
    `export const alpha = () => "${token}";\n`
  );

  return { cacheRoot, env, repoRoot, tempRoot };
};

export const failSmoke = (message, exitCode = 1) => {
  const error = new Error(message);
  error.exitCode = exitCode;
  throw error;
};

export const runSmokeNode = (label, args, { cwd, env, options = {} }) => {
  const {
    stdio = 'pipe',
    timeout,
    ...spawnOptions
  } = options;
  const result = runNodeHelper(args, label, cwd, env, {
    stdio,
    timeoutMs: timeout,
    allowFailure: true,
    spawnOptions
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    if (stderr) console.error(stderr);
    if (stdout) console.error(stdout);
    failSmoke(`Failed: ${label}`, result.status ?? 1);
  }
  return result;
};
