import fs from 'node:fs';
import path from 'node:path';

import { setScmCommandRunner } from '../../../src/index/scm/runner.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

export const ensureGitMetaReadmeTarget = () => {
  ensureTestingEnv(process.env);
  const root = process.cwd();
  const target = path.join(root, 'README.md');
  if (!fs.existsSync(target)) {
    console.error(`Missing README.md at ${target}`);
    process.exit(1);
  }
  return { root, target };
};

export const withScmCommandRunner = async (runner, callback) => {
  setScmCommandRunner(runner);
  try {
    return await callback();
  } finally {
    setScmCommandRunner(null);
  }
};

export const createCountingFatalGitRunner = () => {
  let calls = 0;
  return {
    runner: async () => {
      calls += 1;
      return {
        exitCode: 128,
        stdout: '',
        stderr: 'fatal: not a git repository (or any of the parent directories): .git'
      };
    },
    getCallCount: () => calls
  };
};
