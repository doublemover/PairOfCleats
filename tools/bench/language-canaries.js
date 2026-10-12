#!/usr/bin/env node
import { guardBootstrapEntry } from '../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
import path from 'node:path';

const { createCli } = await import('../../src/shared/cli.js');
const { writeJsonFileResolved } = await import('../../src/shared/json-file.js');
const { resolveRepoRootArg } = await import('../shared/dict-utils.js');
const { writeTextIfChanged } = await import('../shared/generated-report.js');
const {
  buildBenchRuntimeLiveCanarySummary,
  formatBenchRuntimeLiveCanarySummaryMarkdown,
  loadBenchRuntimeCanaryManifest,
  runBenchRuntimeLiveCanary,
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
  const results = [];
  for (const entry of entries) {
    results.push(await runBenchRuntimeLiveCanary(entry, root));
  }
  const summary = buildBenchRuntimeLiveCanarySummary(results, {
    requireTarget: argv['require-target'] === true
  });

  const outJsonPath = String(argv['out-json'] || '').trim()
    ? path.resolve(root, String(argv['out-json']).trim())
    : '';
  const outMdPath = String(argv['out-md'] || '').trim()
    ? path.resolve(root, String(argv['out-md']).trim())
    : '';

  if (outJsonPath) {
    await writeJsonFileResolved(outJsonPath, summary, { trailingNewline: true });
  }
  if (outMdPath) {
    await writeTextIfChanged(outMdPath, formatBenchRuntimeLiveCanarySummaryMarkdown(summary), { encoding: 'utf8' });
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.ok) process.exit(1);
};

run().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
