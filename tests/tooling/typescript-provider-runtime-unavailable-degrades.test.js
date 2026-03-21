#!/usr/bin/env node
import assert from 'node:assert/strict';
import { TOOLING_PROVIDERS, registerToolingProvider } from '../../src/index/tooling/provider-registry.js';
import { createTypeScriptProvider } from '../../src/index/tooling/typescript-provider.js';
import { runToolingProviders } from '../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';

TOOLING_PROVIDERS.clear();
registerToolingProvider(createTypeScriptProvider());

const repoRoot = resolveTestCachePath(process.cwd(), 'typescript-runtime-missing');
const chunkUid = 'ck:test:typescript:runtime-missing';
const result = await runToolingProviders({
  repoRoot,
  buildRoot: repoRoot,
  strict: true,
  toolingConfig: {
    typescript: {
      resolveOrder: ['repo']
    }
  },
  cache: { enabled: false }
}, {
  documents: [{
    virtualPath: 'src/sample.ts',
    effectiveExt: '.ts',
    languageId: 'typescript',
    text: 'export function alpha(): number { return 1; }\n',
    docHash: 'doc-typescript-runtime-missing',
    containerPath: 'src/sample.ts'
  }],
  targets: [{
    virtualPath: 'src/sample.ts',
    languageId: 'typescript',
    virtualRange: { start: 0, end: 20 },
    chunkRef: {
      chunkUid,
      chunkId: 'chunk_typescript_runtime_missing',
      file: 'src/sample.ts',
      start: 0,
      end: 20
    },
    symbolHint: { name: 'alpha', kind: 'function' }
  }]
});

const checks = result.diagnostics?.typescript?.checks || [];
const runtimeUnavailable = checks.find((check) => check?.name === 'typescript_runtime_unavailable');
assert.ok(runtimeUnavailable, 'expected explicit runtime unavailable diagnostic');
assert.equal(runtimeUnavailable?.triggerClass, 'runtime_unavailable');
assert.equal(runtimeUnavailable?.degradedEligible, true);
assert.equal(
  Array.isArray(result.degradedProviders)
  && result.degradedProviders.some((entry) => entry?.providerId === 'typescript'),
  true,
  'expected runtime-unavailable TypeScript provider to degrade'
);

console.log('typescript runtime unavailable degrades test passed');
