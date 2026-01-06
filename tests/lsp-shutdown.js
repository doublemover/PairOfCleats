#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLspClient } from '../src/integrations/tooling/lsp/client.js';

const root = process.cwd();
const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const logs = [];
const client = createLspClient({
  cmd: process.execPath,
  args: [serverPath, '--exit-on-shutdown'],
  log: (message) => logs.push(message)
});

await client.initialize({ rootUri: pathToFileURL(root).href });
await client.shutdownAndExit();
await new Promise((resolve) => setTimeout(resolve, 200));
client.kill();

if (logs.some((line) => line.includes('ERR_STREAM_DESTROYED'))) {
  throw new Error('LSP shutdown emitted ERR_STREAM_DESTROYED.');
}

console.log('LSP shutdown test passed');
