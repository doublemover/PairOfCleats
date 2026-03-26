#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const directExecutionTargets = [
  'tools/index-snapshot.js',
  'tools/index-diff.js',
  'tools/workspace/status.js',
  'tools/workspace/manifest.js',
  'tools/workspace/build.js',
  'tools/build/embeddings.js',
  'tools/tooling/doctor.js',
  'tools/index/validate.js',
  'tools/index/reconcile-identity.js',
  'tools/reports/diagnostics-report.js',
  'tools/bench/graph-caps-harness.js',
  'tools/bench/graph/neighborhood-index-dir.js',
  'tools/bench/graph/context-pack-latency.js',
  'tools/analysis/delta-risk.js',
  'tools/analysis/explain-risk.js',
  'src/retrieval/cli.js',
  'src/integrations/tooling/suggest-tests.js',
  'src/integrations/tooling/impact.js',
  'src/integrations/tooling/graph-context.js',
  'src/integrations/tooling/context-pack.js',
  'src/integrations/tooling/architecture-check.js',
  'src/integrations/tooling/api-contracts.js'
];

const runtimeBootstrapTargets = [
  'tools/analysis/map-iso-serve.js',
  'tools/bench/language-matrix.js',
  'tools/bench/embeddings/model-bakeoff.js'
];

for (const relativePath of directExecutionTargets) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  assert.match(
    source,
    /\bisDirectExecution\s*\(/,
    `${relativePath} should use shared direct execution detection`
  );
  assert.doesNotMatch(
    source,
    /process\.argv\[1\]\s*===\s*fileURLToPath\(import\.meta\.url\)/,
    `${relativePath} should not use symlink-unsafe direct execution guards`
  );
}

for (const relativePath of runtimeBootstrapTargets) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  assert.match(
    source,
    /\bbootstrapRuntime\s*\(/,
    `${relativePath} should use bootstrapRuntime for repo/runtime env shaping`
  );
}

console.log('shared adoption contract test passed');
