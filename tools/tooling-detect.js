#!/usr/bin/env node
import { createCli } from '../src/shared/cli.js';
import path from 'node:path';
import { buildToolingReport, normalizeLanguageList } from './tooling-utils.js';
import { resolveRepoRoot } from './dict-utils.js';

const argv = createCli({
  scriptName: 'tooling-detect',
  options: {
    json: { type: 'boolean', default: false },
    root: { type: 'string' },
    repo: { type: 'string' },
    languages: { type: 'string' }
  }
}).parse();

const explicitRoot = argv.root || argv.repo;
const root = explicitRoot ? path.resolve(explicitRoot) : resolveRepoRoot(process.cwd());
const languageOverride = normalizeLanguageList(argv.languages);

const report = await buildToolingReport(root, languageOverride, {
  skipScan: languageOverride.length > 0
});

if (argv.json) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const languageList = Object.keys(report.languages || {});
if (!languageList.length) {
  console.error('[tooling] No target languages detected.');
} else {
  console.error(`[tooling] Languages detected: ${languageList.join(', ')}`);
}

if (Object.keys(report.formats || {}).length) {
  const formatList = Object.keys(report.formats).join(', ');
  console.error(`[tooling] Formats detected: ${formatList}`);
}

const missing = report.tools.filter((tool) => !tool.found);
const available = report.tools.filter((tool) => tool.found);
if (available.length) {
  console.error('[tooling] Available tools:');
  for (const tool of available) {
    console.error(`- ${tool.id} (${tool.label})`);
  }
}

if (missing.length) {
  console.error('[tooling] Missing tools:');
  for (const tool of missing) {
    console.error(`- ${tool.id} (${tool.label})`);
    if (tool.docs) console.error(`  Docs: ${tool.docs}`);
  }
  console.error('Run: node tools/tooling-install.js --scope cache');
}
