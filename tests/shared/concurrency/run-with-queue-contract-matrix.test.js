#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import PQueue from 'p-queue';

import { isAbortError } from '../../../src/shared/abort.js';
import { runWithQueue } from '../../../src/shared/concurrency.js';
import { applyTestEnv, ensureTestingEnv } from '../../helpers/test-env.js';

applyTestEnv();
ensureTestingEnv(process.env);

const childEnv = () => applyTestEnv({ syncProcess: false });

const spawnModuleEval = async (lines, { expectAliveAfterMs = null } = {}) => {
  const child = spawn(
    process.execPath,
    ['--input-type=module', '-e', lines.join('\n')],
    {
      cwd: process.cwd(),
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  if (Number.isFinite(expectAliveAfterMs) && expectAliveAfterMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, expectAliveAfterMs));
    assert.equal(
      child.exitCode,
      null,
      `expected child to remain alive after ${expectAliveAfterMs}ms; stderr=${stderr || '<empty>'}`
    );
    child.kill();
  }

  const closeResult = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (exitCode, signal) => resolve({ exitCode, signal }));
  });

  return {
    ...closeResult,
    stdout,
    stderr
  };
};

const cases = [
  {
    name: 'iterable inputs preserve input order',
    async run() {
      const queue = new PQueue({ concurrency: 2 });
      const setItems = new Set(['a', 'b', 'c']);
      const setResults = await runWithQueue(queue, setItems, async (item) => item.toUpperCase());
      assert.deepEqual(setResults, ['A', 'B', 'C']);

      function *gen() {
        yield 1;
        yield 2;
        yield 3;
      }
      const genResults = await runWithQueue(queue, gen(), async (item) => item * 2);
      assert.deepEqual(genResults, [2, 4, 6]);
    }
  },
  {
    name: 'worker failures propagate without unhandled rejections',
    async run() {
      const queue = new PQueue({ concurrency: 2 });
      const unhandled = [];
      const onUnhandled = (reason) => {
        unhandled.push(reason);
      };
      process.on('unhandledRejection', onUnhandled);
      const err = await runWithQueue(
        queue,
        [0, 1, 2],
        async (item) => {
          if (item === 1) throw new Error('boom');
          return item;
        }
      ).then(() => null, (error) => error);
      process.removeListener('unhandledRejection', onUnhandled);

      assert.ok(err instanceof Error);
      assert.equal(err.message, 'boom');
      assert.equal(unhandled.length, 0);
    }
  },
  {
    name: 'best-effort mode records all successes and failures',
    async run() {
      const queue = new PQueue({ concurrency: 2 });
      const items = ['a', 'b', 'c', 'd'];
      const failures = new Set(['b', 'd']);
      const onResult = [];
      const onError = [];
      let processed = 0;

      const err = await runWithQueue(
        queue,
        items,
        async (item) => {
          processed += 1;
          if (failures.has(item)) throw new Error(`fail:${item}`);
          return item.toUpperCase();
        },
        {
          bestEffort: true,
          onResult: (_result, ctx) => {
            onResult.push(ctx.index);
          },
          onError: (_error, ctx) => {
            onError.push(ctx.index);
          }
        }
      ).then(() => null, (error) => error);

      assert.ok(err instanceof AggregateError);
      assert.equal(err.errors.length, failures.size);
      assert.equal(processed, items.length);
      assert.equal(onResult.length, items.length - failures.size);
      assert.equal(onError.length, failures.size);
    }
  },
  {
    name: 'fail-fast backpressure stops dispatch after first rejection',
    async run() {
      const queue = new PQueue({ concurrency: 1 });
      queue.maxPending = 1;
      const started = [];
      const err = await runWithQueue(
        queue,
        [0, 1, 2],
        async (item) => {
          started.push(item);
          if (item === 0) throw new Error('fail-fast');
          await new Promise((resolve) => setTimeout(resolve, 10));
          return item;
        }
      ).then(() => null, (error) => error);

      assert.ok(err instanceof Error);
      assert.equal(err.message, 'fail-fast');
      assert.deepEqual(started, [0]);
    }
  },
  {
    name: 'abort signal interrupts queued work',
    async run() {
      const queue = new PQueue({ concurrency: 1 });
      const controller = new AbortController();
      const items = [1, 2, 3, 4, 5];

      setTimeout(() => controller.abort(), 30);

      const err = await runWithQueue(
        queue,
        items,
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return true;
        },
        { signal: controller.signal }
      ).then(() => null, (error) => error);

      assert.ok(isAbortError(err), `expected AbortError, got ${err?.name || err}`);
    }
  },
  {
    name: 'backpressure keepalive prevents unsettled top-level await exit',
    async run() {
      const result = await spawnModuleEval(
        [
          "import PQueue from 'p-queue';",
          "import { runWithQueue } from './src/shared/concurrency.js';",
          'const queue = new PQueue({ concurrency: 1 });',
          'queue.maxPending = 1;',
          'await runWithQueue(queue, [1, 2], async (item) => item, {',
          '  collectResults: false,',
          '  onResult: async () => {',
          '    await new Promise(() => {});',
          '  }',
          '});'
        ],
        { expectAliveAfterMs: 200 }
      );

      assert.notEqual(
        result.exitCode,
        13,
        `expected keepalive child to avoid unsettled top-level await exit 13; stderr=${result.stderr || '<empty>'}`
      );
    }
  },
  {
    name: 'pending-drain keepalive exits cleanly after timeout',
    async run() {
      const result = await spawnModuleEval([
        "import PQueue from 'p-queue';",
        "import { runWithQueue } from './src/shared/concurrency.js';",
        'const queue = new PQueue({ concurrency: 1 });',
        'try {',
        '  await runWithQueue(queue, [1], async (item) => item, {',
        '    collectResults: false,',
        '    pendingDrainTimeoutMs: 120,',
        '    onResult: async () => {',
        '      await new Promise(() => {});',
        '    }',
        '  });',
        "  throw new Error('expected pending drain timeout');",
        '} catch (error) {',
        "  if (error?.code !== 'RUN_WITH_QUEUE_PENDING_DRAIN_TIMEOUT') throw error;",
        "  process.stdout.write('TIMED_OUT\\n');",
        '}'
      ]);

      assert.equal(
        result.exitCode,
        0,
        `expected pending-drain child exit=0; signal=${result.signal} stderr=${result.stderr || '<empty>'}`
      );
      assert.match(result.stdout, /TIMED_OUT/);
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('runWithQueue contract matrix test passed');
