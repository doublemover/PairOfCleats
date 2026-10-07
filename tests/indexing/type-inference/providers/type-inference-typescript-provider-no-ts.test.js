#!/usr/bin/env node
import path from 'node:path';
import { createTypeScriptProvider } from '../../../../src/index/tooling/typescript-provider.js';

import {
  createLogCapture,
  createProviderFallbackRequest,
  prepareProviderFallbackFixture
} from './provider-fallback-fixture.js';

const root = process.cwd();
const docText = 'export function greet(name: string) { return `hi ${name}`; }\n';
const { repoRoot } = await prepareProviderFallbackFixture({
  root,
  cacheName: 'typescript-provider-no-ts',
  fileName: 'sample.ts',
  source: docText
});
const { documents, targets } = createProviderFallbackRequest({
  fileName: 'sample.ts',
  docText,
  languageId: 'typescript',
  effectiveExt: '.ts'
});
const { log, logs } = createLogCapture();
const toolingConfig = {
  dir: path.join(repoRoot, '.tooling'),
  typescript: {
    enabled: true,
    resolveOrder: ['cache'],
    useTsconfig: true
  }
};

const provider = createTypeScriptProvider();
const result = await provider.run({
  repoRoot,
  buildRoot: repoRoot,
  toolingConfig,
  strict: true,
  logger: log
}, { documents, targets });

if (!result || !result.byChunkUid || typeof result.byChunkUid !== 'object') {
  console.error('TypeScript provider did not return a byChunkUid map.');
  process.exit(1);
}

if (Object.keys(result.byChunkUid).length !== 0) {
  console.error('TypeScript provider should return empty map when module is missing.');
  process.exit(1);
}

if (!logs.some((entry) => entry.includes('TypeScript tooling not detected'))) {
  console.error('TypeScript provider missing expected fallback log message.');
  process.exit(1);
}

console.log('TypeScript provider fallback test passed');
