import { createSchedulerQueueAdapter } from '../../../src/shared/concurrency/queue-adapter.js';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const createStage1NestedSchedulerFixture = (queueSpecs = []) => {
  const scheduler = createBuildScheduler({
    adaptive: true,
    adaptiveIntervalMs: 1,
    cpuTokens: 8,
    ioTokens: 8,
    memoryTokens: 8,
    queues: {
      'stage1.cpu': { priority: 10, surface: 'parse' }
    },
    adaptiveSurfaces: {
      enabled: true,
      parse: {
        minConcurrency: 2,
        maxConcurrency: 2,
        initialConcurrency: 2,
        upCooldownMs: 0,
        downCooldownMs: 0,
        oscillationGuardMs: 0
      }
    }
  });
  const createQueue = ({ queueName, tokens }) => createSchedulerQueueAdapter({
    scheduler,
    queueName,
    tokens,
    concurrency: 2
  });

  return {
    scheduler,
    cpuQueue: createQueue({ queueName: 'stage1.cpu', tokens: { cpu: 1 } }),
    queues: Object.fromEntries(
      queueSpecs.map((spec) => [spec.key || spec.queueName, createQueue(spec)])
    )
  };
};

export const raceSchedulerTimeout = async (promise, timeoutMs = 750) => {
  const timeoutResult = Symbol('timeout');
  const result = await Promise.race([
    promise,
    sleep(timeoutMs).then(() => timeoutResult)
  ]);
  return { result, timeoutResult };
};

export const runStage1NestedSchedulerProbe = async (queueSpecs, createTasks, { timeoutMs } = {}) => {
  const fixture = createStage1NestedSchedulerFixture(queueSpecs);
  try {
    const nested = Promise.all(createTasks(fixture));
    return await raceSchedulerTimeout(nested, timeoutMs);
  } finally {
    fixture.scheduler.shutdown();
  }
};
