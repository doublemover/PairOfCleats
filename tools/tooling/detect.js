#!/usr/bin/env node
import { createCli } from '../../src/shared/cli.js';
import { TOOLING_DETECT_OPTIONS } from '../../src/shared/cli-options.js';
import { buildToolingReport, normalizeLanguageList } from './utils.js';
import { resolveRepoRootArg } from '../shared/dict-utils.js';
import { emitJson } from '../shared/cli-utils.js';
import { redactDiagnosticText } from '../../src/shared/diagnostic-text.js';

const argv = createCli({
  scriptName: 'pairofcleats tooling detect',
  options: TOOLING_DETECT_OPTIONS
}).parse();

const explicitRoot = argv.root || argv.repo;
const root = resolveRepoRootArg(explicitRoot);
const languageOverride = normalizeLanguageList(argv.languages);
const cancellation = new AbortController();
let cancellationExitCode = null;
const onInterrupt = () => { cancellationExitCode = 130; cancellation.abort(new Error('Tooling detection interrupted.')); };
const onTerminate = () => { cancellationExitCode = 143; cancellation.abort(new Error('Tooling detection terminated.')); };
process.once('SIGINT', onInterrupt);
process.once('SIGTERM', onTerminate);

try {
const report = await buildToolingReport(root, languageOverride, {
  skipScan: languageOverride.length > 0, signal: cancellation.signal
});

if (argv.json) {
  emitJson(report);
} else {

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
  console.error('Run: pairofcleats tooling install --scope cache');
}
}
} catch (error) {
  const failure = { root, languages: {}, formats: {}, tools: [], ready: false,
    state: error.cacheOwnershipPending ? 'settlement-pending' : cancellation.signal.aborted ? 'cancelled' : 'blocked',
    error: { code: error.code || 'ERR_TOOLING_DETECT', message: redactDiagnosticText(error.message || String(error), 2048) } };
  if (argv.json) emitJson(failure);
  else console.error(`[tooling] ${failure.state}: ${failure.error.message}`);
  process.exitCode = cancellationExitCode || 1;
} finally {
  process.removeListener('SIGINT', onInterrupt);
  process.removeListener('SIGTERM', onTerminate);
}
