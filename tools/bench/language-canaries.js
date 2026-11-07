#!/usr/bin/env node
import { guardBootstrapEntry } from '../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
import path from 'node:path';

const { createCli } = await import('../../src/shared/cli.js');
const { publishBenchRuntimeCanarySummary } = await import('./language/canary-reports.js');
const { resolveRepoRootArg } = await import('../shared/dict-utils.js');
const {
  loadBenchRuntimeCanaryManifest,
  runBenchRuntimeCanaryLane,
  validateBenchRuntimeCanaryManifest
} = await import('./language/canaries.js');

const argv = createCli({
  scriptName: 'pairofcleats bench language canaries',
  options: {
    only: { type: 'string', default: '' },
    'require-target': { type: 'boolean', default: false },
    'out-json': { type: 'string', default: '' },
    'out-md': { type: 'string', default: '' }
  }
}).parse();

const root = resolveRepoRootArg(null, process.cwd());

const selectedIds = new Set(
  String(argv.only || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
);

const run = async () => {
  const { manifest } = await loadBenchRuntimeCanaryManifest(root);
  const manifestFailures = validateBenchRuntimeCanaryManifest(manifest);
  if (manifestFailures.length) {
    throw new Error(`invalid bench runtime canary manifest:\n- ${manifestFailures.join('\n- ')}`);
  }
  const entries = (manifest.liveCanaries || []).filter((entry) => (
    selectedIds.size === 0 || selectedIds.has(String(entry?.id || '').trim())
  ));
  if (entries.length === 0) {
    throw new Error('no live canaries matched the requested filter');
  }
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  let summary;
  try {
    summary = await runBenchRuntimeCanaryLane(entries, root, {
      requireTarget: argv['require-target'] === true, signal: controller.signal
    });
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }

  const outJsonPath = String(argv['out-json'] || '').trim()
    ? path.resolve(root, String(argv['out-json']).trim())
    : '';
  const outMdPath = String(argv['out-md'] || '').trim()
    ? path.resolve(root, String(argv['out-md']).trim())
    : '';

  await publishBenchRuntimeCanarySummary(summary, { outJsonPath, outMdPath });

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.ok) process.exitCode = 1;
};

run().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
