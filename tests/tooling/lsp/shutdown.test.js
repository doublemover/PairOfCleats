#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLspClient } from '../../../src/integrations/tooling/lsp/client.js';
import { createTimeoutError, runWithTimeout } from '../../../src/shared/promise-timeout.js';
import { sleep } from '../../../src/shared/sleep.js';

const root = process.cwd();
const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const logs = [];
const client = createLspClient({
  cmd: process.execPath,
  args: [serverPath, '--exit-on-shutdown'],
  log: (message) => logs.push(message)
});

try {
  await client.initialize({ rootUri: pathToFileURL(root).href });
  await runWithTimeout(
    () => client.shutdownAndExit(),
    {
      timeoutMs: 7000,
      errorFactory: () => createTimeoutError({
        code: 'ERR_TEST_TIMEOUT',
        message: 'LSP shutdownAndExit did not settle within 7000ms.'
      })
    }
  );
  await sleep(200);
} finally {
  await Promise.resolve(client.kill());
}

if (logs.some((line) => line.includes('ERR_STREAM_DESTROYED'))) {
  throw new Error('LSP shutdown emitted ERR_STREAM_DESTROYED.');
}
if (logs.some((line) => /\[lsp\]\s+write error:/i.test(line))) {
  throw new Error('LSP shutdown emitted unexpected LSP write error.');
}
if (logs.some((line) => /\bEPIPE\b/i.test(line))) {
  throw new Error('LSP shutdown emitted EPIPE log noise.');
}

console.log('LSP shutdown test passed');
