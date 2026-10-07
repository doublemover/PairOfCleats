import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { runNode } from '../../../helpers/run-node.js';

export const consoleLogFixtureSource = (lines) => [
  '#!/usr/bin/env node',
  ...lines.map((line) => `console.log(${JSON.stringify(line)});`),
  ''
];

export const createBenchRunnerFixture = async (cacheName) => {
  const root = process.cwd();
  const tempRoot = resolveTestCachePath(root, cacheName);
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(tempRoot, { recursive: true });

  const benchRunner = path.join(root, 'tools', 'bench', 'bench-runner.js');
  const testEnv = applyTestEnv({ syncProcess: false });

  const writeFixture = async (name, sourceLines) => {
    const fixtureScript = path.join(tempRoot, `${name}.fixture.js`);
    await fs.writeFile(fixtureScript, sourceLines.join('\n'), 'utf8');
    return fixtureScript;
  };

  const runFixtureScript = (fixtureScript, { timeoutMs = 2000 } = {}) => {
    const result = runNode(
      [benchRunner, '--scripts', fixtureScript, '--timeout-ms', String(timeoutMs)],
      `bench runner fixture ${path.basename(fixtureScript)}`,
      root,
      testEnv,
      { stdio: 'pipe', allowFailure: true }
    );

    if (result.status !== 0) {
      console.error(result.stdout || '');
      console.error(result.stderr || '');
      process.exit(result.status ?? 1);
    }

    return JSON.parse(String(result.stdout || '{}'));
  };

  const runFixture = async (name, sourceLines, options) => {
    const fixtureScript = await writeFixture(name, sourceLines);
    return runFixtureScript(fixtureScript, options);
  };

  return {
    root,
    tempRoot,
    writeFixture,
    runFixtureScript,
    runFixture
  };
};
