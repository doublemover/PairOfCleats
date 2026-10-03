#!/usr/bin/env node
import assert from 'node:assert/strict';
import { TOOLING_PROVIDERS, registerToolingProvider } from '../../src/index/tooling/provider-registry.js';
import { createTypeScriptProvider } from '../../src/index/tooling/typescript-provider.js';
import { runToolingProviders } from '../../src/index/tooling/orchestrator.js';

TOOLING_PROVIDERS.clear();
registerToolingProvider(createTypeScriptProvider());

const chunkUid = 'ck:test:typescript:planner-skip';
const result = await runToolingProviders({
  repoRoot: process.cwd(),
  buildRoot: process.cwd(),
  strict: true,
  toolingConfig: {},
  cache: { enabled: false }
}, {
  documents: [{
    virtualPath: 'src/sample.ts',
    effectiveExt: '.ts',
    languageId: 'typescript',
    text: 'export function alpha(): number { return 1; }\n',
    docHash: 'doc-typescript-planner-skip',
    containerPath: 'src/sample.ts'
  }],
  targets: [{
    virtualPath: 'src/sample.ts',
    languageId: 'typescript',
    virtualRange: { start: 500, end: 550 },
    chunkRef: {
      chunkUid,
      chunkId: 'chunk_typescript_planner_skip',
      file: 'src/sample.ts',
      start: 500,
      end: 550
    },
    symbolHint: { name: 'alpha', kind: 'function' }
  }]
});

assert.equal(result.byChunkUid.has(chunkUid), false, 'expected planner miss to skip contribution');
assert.equal(
  Array.isArray(result.degradedProviders)
  && result.degradedProviders.some((entry) => entry?.providerId === 'typescript'),
  false,
  'expected planner-only TypeScript miss not to degrade provider health'
);
assert.equal(
  Array.isArray(result.observations)
  && result.observations.some((entry) => entry?.code === 'tooling_provider_degraded_mode' && entry?.context?.providerId === 'typescript'),
  false,
  'expected no degraded-mode observation for planner-only TypeScript miss'
);
const checks = result.diagnostics?.typescript?.checks || [];
const nodeMatch = checks.find((check) => check?.name === 'node_match');
assert.ok(nodeMatch, 'expected node_match diagnostic');
assert.equal(nodeMatch?.triggerClass, 'planner_target_match');
assert.equal(nodeMatch?.degradedEligible, false);
assert.equal(nodeMatch?.contributionState, 'skipped');

console.log('typescript planner skips do not degrade test passed');
