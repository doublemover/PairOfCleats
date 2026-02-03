#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCli } from '../../src/shared/cli.js';
import { getToolingConfig, loadUserConfig, resolveRepoRoot } from '../shared/dict-utils.js';
import { registerDefaultToolingProviders } from '../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../src/index/tooling/doctor.js';
import { resolveScmConfig } from '../../src/index/scm/registry.js';

const formatSummaryLine = (label, value) => `- ${label}: ${value}`;

async function runCli() {
  const argv = createCli({
    scriptName: 'tooling-doctor',
    options: {
      json: { type: 'boolean', default: false },
      repo: { type: 'string' },
      strict: { type: 'boolean', default: true },
      'non-strict': { type: 'boolean', default: false }
    }
  }).parse();

  if (argv.strict && argv['non-strict']) {
    throw new Error('Choose either --strict or --non-strict, not both.');
  }

  const rootArg = argv.repo ? path.resolve(argv.repo) : null;
  const repoRoot = rootArg || resolveRepoRoot(process.cwd());
  const userConfig = loadUserConfig(repoRoot);
  const toolingConfig = getToolingConfig(repoRoot, userConfig);
  const strict = argv['non-strict'] ? false : argv.strict !== false;
  const scmConfig = resolveScmConfig({
    indexingConfig: userConfig.indexing || {},
    analysisPolicy: userConfig.analysisPolicy || null
  });

  registerDefaultToolingProviders();
  const report = await runToolingDoctor({
    repoRoot,
    buildRoot: repoRoot,
    toolingConfig,
    scmConfig,
    strict
  }, null, { log: (message) => console.error(message) });

  if (argv.json) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.summary.status === 'error' ? 1 : 0);
  }

  console.error('Tooling doctor');
  console.error(formatSummaryLine('repo', report.repoRoot));
  if (report.scm) {
    const annotateLabel = report.scm.annotateEnabled ? 'annotate:on' : 'annotate:off';
    console.error(formatSummaryLine('scm', `${report.scm.provider} (${annotateLabel})`));
  }
  console.error(formatSummaryLine('status', report.summary.status));
  console.error(formatSummaryLine('chunkUid', report.identity.chunkUid.available ? 'ok' : 'missing'));
  console.error(formatSummaryLine('xxhash', report.xxhash.backend));

  const providers = Array.isArray(report.providers) ? report.providers : [];
  for (const provider of providers) {
    const enabled = provider.enabled ? 'enabled' : `disabled (${provider.reasonsDisabled.join(', ') || 'unknown'})`;
    console.error(formatSummaryLine(provider.id, `${provider.status} / ${enabled}`));
    for (const check of provider.checks || []) {
      const marker = check.status === 'error' ? '!' : (check.status === 'warn' ? '~' : 'ok');
      console.error(`  - ${marker} ${check.name}: ${check.message}`);
    }
  }

  process.exit(report.summary.status === 'error' ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
