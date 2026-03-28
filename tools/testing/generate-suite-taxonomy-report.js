#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSuiteTaxonomyReport } from '../../tests/runner/suite-taxonomy-report.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const main = async () => {
  const result = await generateSuiteTaxonomyReport({ root: ROOT });
  process.stdout.write(`suite taxonomy json: ${path.relative(ROOT, result.outputJsonPath).replace(/\\/g, '/')}\n`);
  process.stdout.write(`suite taxonomy md: ${path.relative(ROOT, result.outputMarkdownPath).replace(/\\/g, '/')}\n`);
  for (const lane of result.report.lanes) {
    process.stdout.write(`${lane.lane}\t${lane.totalTests}\t${JSON.stringify(lane.byCategory)}\n`);
  }
};

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
