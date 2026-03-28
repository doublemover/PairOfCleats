#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateLaneEvidence } from '../../tests/runner/lane-evidence.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const main = async () => {
  const result = await generateLaneEvidence({ root: ROOT });
  process.stdout.write(`lane evidence json: ${path.relative(ROOT, result.outputJsonPath).replace(/\\/g, '/')}\n`);
  process.stdout.write(`lane evidence md: ${path.relative(ROOT, result.outputMarkdownPath).replace(/\\/g, '/')}\n`);
  for (const lane of result.report.lanes) {
    process.stdout.write(
      `${lane.lane}\t${lane.totalTests}\t${lane.knownDurationTests}\t${lane.knownDurationMs ?? 0}ms\t${lane.timingArtifactPath}\n`
    );
  }
};

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
