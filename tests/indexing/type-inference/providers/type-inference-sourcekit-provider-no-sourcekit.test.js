#!/usr/bin/env node
import { createSourcekitProvider } from '../../../../src/index/tooling/sourcekit-provider.js';

import {
  createLogCapture,
  createProviderFallbackRequest,
  prepareProviderFallbackFixture
} from './provider-fallback-fixture.js';

const root = process.cwd();
const docText = 'func greet(name: String) -> String { return "hi" }\n';
const { repoRoot } = await prepareProviderFallbackFixture({
  root,
  cacheName: 'sourcekit-provider-no-sourcekit',
  fileName: 'sample.swift',
  source: docText
});
const { documents, targets } = createProviderFallbackRequest({
  fileName: 'sample.swift',
  docText,
  languageId: 'swift',
  effectiveExt: '.swift'
});
const { log, logs } = createLogCapture();

const provider = createSourcekitProvider();
const originalPath = process.env.PATH;
process.env.PATH = '';
let result = null;
try {
  result = await provider.run({
    repoRoot,
    buildRoot: repoRoot,
    toolingConfig: {},
    strict: true,
    logger: log
  }, { documents, targets });
} finally {
  process.env.PATH = originalPath;
}

if (!result || !result.byChunkUid || typeof result.byChunkUid !== 'object') {
  console.error('sourcekit provider did not return a byChunkUid map.');
  process.exit(1);
}

if (Object.keys(result.byChunkUid).length !== 0) {
  console.error('sourcekit provider should return empty map when sourcekit-lsp is missing.');
  process.exit(1);
}
const checks = Array.isArray(result?.diagnostics?.checks) ? result.diagnostics.checks : [];
if (!checks.some((entry) => entry?.name === 'sourcekit_command_unavailable')) {
  console.error('sourcekit provider should emit sourcekit_command_unavailable when sourcekit-lsp is missing.');
  process.exit(1);
}

if (!logs.some((entry) => entry.includes('sourcekit-lsp not detected'))) {
  console.error('sourcekit provider missing expected fallback log message.');
  process.exit(1);
}

console.log('sourcekit provider fallback test passed');
