#!/usr/bin/env node
import minimist from 'minimist';
import { buildToolingReport, normalizeLanguageList } from './tooling-utils.js';

const argv = minimist(process.argv.slice(2), {
  boolean: ['json'],
  string: ['root', 'languages'],
  default: { json: false }
});

const root = argv.root || process.cwd();
const languageOverride = normalizeLanguageList(argv.languages);

const report = await buildToolingReport(root, languageOverride);

if (argv.json) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const languageList = Object.keys(report.languages || {});
if (!languageList.length) {
  console.log('[tooling] No target languages detected.');
} else {
  console.log(`[tooling] Languages detected: ${languageList.join(', ')}`);
}

if (Object.keys(report.formats || {}).length) {
  const formatList = Object.keys(report.formats).join(', ');
  console.log(`[tooling] Formats detected: ${formatList}`);
}

const missing = report.tools.filter((tool) => !tool.found);
const available = report.tools.filter((tool) => tool.found);
if (available.length) {
  console.log('[tooling] Available tools:');
  for (const tool of available) {
    console.log(`- ${tool.id} (${tool.label})`);
  }
}

if (missing.length) {
  console.log('[tooling] Missing tools:');
  for (const tool of missing) {
    console.log(`- ${tool.id} (${tool.label})`);
    if (tool.docs) console.log(`  Docs: ${tool.docs}`);
  }
  console.log('Run: npm run tooling-install -- --scope cache');
}
