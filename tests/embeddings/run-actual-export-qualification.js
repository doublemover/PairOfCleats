import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireBootstrap } from '../../src/shared/bootstrap-readiness.js';
import { runQualificationCapsule } from '../../tools/bench/qualification-capsule.js';

/** Manual supervisor only; no ordinary test discovery or optional skip. */
await requireBootstrap();
const args = process.argv.slice(2), position = args.indexOf('--out');
assert.ok(position >= 0 && args[position + 1], 'An explicit new --out directory is required.');
const output = path.resolve(args[position + 1]);
const child = fileURLToPath(new URL('./actual-export-qualification.js', import.meta.url));
await runQualificationCapsule({ args: [child, ...args], receiptPath: output + '.process.json' });
const receipt = JSON.parse(await fs.readFile(path.join(output, 'receipt.json'), 'utf8'));
assert.ok(['passed', 'numerical-reference', 'sampled-reference'].includes(receipt.status),
  'Process completion alone cannot establish actual-model consumer acceptance.');
assert.ok(receipt.elapsedMs < 30000 && receipt.modelArtifact?.status === 'verified');
console.log(JSON.stringify({ status: receipt.status, receipt: path.join(output, 'receipt.json'),
  processReceipt: output + '.process.json', totalChildDeadlineMs: 30000 }));
