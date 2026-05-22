import { createLspClient } from '../../../../src/integrations/tooling/lsp/client.js';
import { sleep } from '../../../../src/shared/sleep.js';
import { createTrackedFakeChildProcessSpawner } from './fake-child-process.js';

export const createStaleProcessRestartHarness = () => {
  const lifecycleEvents = [];
  const { spawnedChildren, spawnProcess } = createTrackedFakeChildProcessSpawner();
  const client = createLspClient({
    cmd: 'fake-lsp',
    args: ['--stdio'],
    log: () => {},
    onLifecycleEvent: (event) => lifecycleEvents.push(event),
    spawnProcess
  });

  const startWithBackoffRetry = async (attempts = 8) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        client.start();
        return;
      } catch (error) {
        if (!String(error?.message || '').includes('LSP start backoff active')) {
          throw error;
        }
        await sleep(50);
      }
    }
    throw new Error('Timed out waiting for LSP restart backoff window.');
  };

  return {
    client,
    lifecycleEvents,
    spawnedChildren,
    startWithBackoffRetry
  };
};

export { sleep };
