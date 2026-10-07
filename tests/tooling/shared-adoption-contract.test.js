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
  'tools/tooling/install-lua-language-server.js',
  'tools/ci/run-suite.js',
  'tools/config/contract-doc.js',
  'tools/index/validate.js',
  'tools/index/reconcile-identity.js',
  'tools/eval/risk-pack.js',
  'tools/mcp/server-sdk.js',
  'tools/reports/diagnostics-report.js',
  'tools/bench/query-generator.js',
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

const scanJsFiles = (relativeDir) => {
  const absoluteDir = path.join(root, relativeDir);
  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      if (['.testLogs', '.testCache', 'fixtures', 'suggest-tests'].includes(entry.name)) continue;
      files.push(...scanJsFiles(relativePath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(relativePath.split(path.sep).join('/'));
    }
  }
  return files;
};

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

{
  const rootEnvImports = [];
  const rootEnvImportPattern = /(?:\bfrom\s+|\bimport\s+|\bimport\s*\(\s*)['"][^'"]*shared\/env\.js['"]/;
  for (const scanRoot of ['bin', 'src', 'tools', 'tests']) {
    for (const relativePath of scanJsFiles(scanRoot)) {
      const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
      if (rootEnvImportPattern.test(source)) {
        rootEnvImports.push(relativePath);
      }
    }
  }
  assert.deepEqual(
    rootEnvImports,
    [],
    'internal callers should import src/shared/env leaf modules instead of the root facade'
  );
}

console.log('shared adoption contract test passed');
