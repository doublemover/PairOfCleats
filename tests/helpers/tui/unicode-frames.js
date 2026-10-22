// Producer fixture consumed by both JavaScript checks and the actual Rust reader.
import fs from 'node:fs';
import { createFlowController } from '../../../tools/tui/supervisor/protocol-flow.js';
import { formatProgressEvent } from '../../../src/shared/cli/progress-events.js';
const corpus = JSON.parse(fs.readFileSync(new URL('../../fixtures/tui/unicode-chunk-corpus.json', import.meta.url), 'utf8'));
let serial = 0;
for (const boundary of corpus.boundaries) {
  for (const offset of corpus.offsets) {
    for (const symbol of corpus.symbols) {
    const jobId = `unicode-${serial++}`;
    const payload = { status: 'done', result: { value: '' }, ts: '2026-10-21T00:00:00.000Z' };
    const empty = JSON.stringify(formatProgressEvent('job:end', { runId: 'unicode-fixture', jobId, seq: 1, ...payload }));
    const prefixLength = empty.indexOf('"value":"') + '"value":"'.length;
    payload.result.value = 'x'.repeat(boundary * 4096 - prefixLength + offset) + symbol + 'z'.repeat(corpus.tailLength);
    process.stdout.write(`${JSON.stringify({ event: 'fixture:expected', jobId, value: payload.result.value })}\n`);
    let sequence = 0;
    const flow = createFlowController({ runId: 'unicode-fixture', nextSeq: () => ++sequence });
    flow.emit('job:end', payload, { jobId, critical: true });
    }
  }
}
