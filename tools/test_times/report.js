#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';

const parseArgs = () => createCli({
  scriptName: 'pairofcleats test-times',
  options: {
    input: { type: 'string', demandOption: true },
    top: { type: 'number', default: 20 }
  }
})
  .strictOptions()
  .parse();

const main = async () => {
  const argv = parseArgs();
  const inputPath = path.resolve(argv.input);
  const raw = await fsPromises.readFile(inputPath, 'utf8');
  const payload = JSON.parse(raw);
  const tests = Array.isArray(payload.tests) ? payload.tests.slice() : [];
  tests.sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0));
  const top = Math.max(1, Math.floor(argv.top));

  console.error(`Run: ${payload.runId || 'unknown'} | Total: ${payload.totalMs || 0}ms`);
  for (const entry of tests.slice(0, top)) {
    console.error(`- ${entry.id}: ${entry.durationMs || 0}ms (${entry.status || 'unknown'})`);
  }
};

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
