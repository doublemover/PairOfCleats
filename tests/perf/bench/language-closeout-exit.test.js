#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import {
  createBenchLanguageRepoFixture,
  runBenchLanguageRepos
} from './language-repos-fixture.js';

const repoId = 'test/closeout-repo';
const fixture = await createBenchLanguageRepoFixture({
  name: 'bench-language-closeout-exit',
  repoId,
  readme: 'bench closeout exit test'
});

const logPath = path.join(fixture.resultsRoot, 'bench-run.log');
const result = runBenchLanguageRepos({
  fixture,
  args: ['--log', logPath, '--quiet'],
  timeout: 15000
});

if (result.error?.code === 'ETIMEDOUT') {
  console.error('bench-language closeout exit test timed out waiting for process to exit');
  process.exit(1);
}
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || 'bench-language closeout exit test failed');
  process.exit(result.status ?? 1);
}
if (!fs.existsSync(logPath)) {
  console.error('expected bench log path to exist');
  process.exit(1);
}
const logText = await fsPromises.readFile(logPath, 'utf8');
if (!logText.includes('Completed 1 benchmark runs.')) {
  console.error('expected completion marker in bench log');
  process.exit(1);
}
const logsRoot = path.dirname(logPath);
const logEntries = await fsPromises.readdir(logsRoot);
const summaryName = logEntries.find((entry) => entry.endsWith('-run-summary.json'));
const ledgerName = logEntries.find((entry) => entry.endsWith('-run-ledger.jsonl'));
const footerName = logEntries.find((entry) => entry.endsWith('-footer.log'));
if (!summaryName || !ledgerName || !footerName) {
  console.error(`expected bench closeout artifacts in ${logsRoot}; found ${logEntries.join(', ')}`);
  process.exit(1);
}
const summary = JSON.parse(await fsPromises.readFile(path.join(logsRoot, summaryName), 'utf8'));
if (summary?.run?.state !== 'completed') {
  console.error(`expected completed run summary, got ${summary?.run?.state}`);
  process.exit(1);
}
const footerText = await fsPromises.readFile(path.join(logsRoot, footerName), 'utf8');
if (!footerText.includes('State: completed')) {
  console.error('expected completed state in footer artifact');
  process.exit(1);
}

console.log('bench-language closeout exit test passed');
