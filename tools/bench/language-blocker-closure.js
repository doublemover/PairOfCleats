#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { createCli } from '../../src/shared/cli.js';
import {
  buildBenchRuntimeBlockerClosureEvidence,
  formatBenchRuntimeBlockerClosureEvidenceMarkdown
} from './language/canaries.js';

const argv = createCli({
  scriptName: 'pairofcleats bench language blocker-closure',
  options: {
    'live-summary': { type: 'string', demandOption: true },
    'benchmark-report': { type: 'array', default: [] },
    'out-json': { type: 'string', default: '' },
    'out-md': { type: 'string', default: '' },
    'require-closure': { type: 'boolean', default: false }
  }
}).parse();

const root = process.cwd();
const ensureParentDir = (filePath) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const run = async () => {
  const liveSummaryPath = path.resolve(root, String(argv['live-summary']).trim());
  const reportPaths = (Array.isArray(argv['benchmark-report']) ? argv['benchmark-report'] : [])
    .map((entry) => path.resolve(root, String(entry || '').trim()))
    .filter(Boolean);
  const liveSummary = readJson(liveSummaryPath);
  const benchmarkConfirmations = reportPaths
    .map((filePath) => readJson(filePath)?.blockerConfirmations?.summary || null)
    .filter(Boolean);
  const evidence = buildBenchRuntimeBlockerClosureEvidence({
    liveSummary,
    benchmarkConfirmations
  });

  const outJsonPath = String(argv['out-json'] || '').trim()
    ? path.resolve(root, String(argv['out-json']).trim())
    : '';
  const outMdPath = String(argv['out-md'] || '').trim()
    ? path.resolve(root, String(argv['out-md']).trim())
    : '';
  if (outJsonPath) {
    ensureParentDir(outJsonPath);
    fs.writeFileSync(outJsonPath, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  if (outMdPath) {
    ensureParentDir(outMdPath);
    fs.writeFileSync(outMdPath, formatBenchRuntimeBlockerClosureEvidenceMarkdown(evidence));
  }
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (argv['require-closure'] === true && !evidence.ok) {
    process.exit(1);
  }
};

run().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
