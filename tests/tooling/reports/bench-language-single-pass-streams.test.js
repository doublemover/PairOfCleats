#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { buildReportOutput } from '../../../tools/bench/language/report.js';
import { createReportStreamContext, discoverReportStreams, readReportStream } from '../../../tools/bench/language/report-streams.js';

ensureTestingEnv(process.env);
const root = resolveTestCachePath(process.cwd(), 'bench-language-single-pass-streams');
const logs = path.join(root, 'logs', 'bench-language');
await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(path.join(logs, 'nested'), { recursive: true });
try {
  const preflight = '[tooling] preflight:ok provider=gopls id=gopls.workspace-model durationMs=87 state=ready';
  const reuse = '[scm] file-meta snapshot: source=cache requested=10 reused=10 fetched=0. elapsedMs=12';
  for (const repo of ['repo-a', 'repo-b', 'all']) {
    // A selected log contains a material parity event absent from JSONL. Parser
    // crash counters alone are not one of the parity reducer's event classes.
    const unmatchedFallback = repo === 'repo-a' ? 'using fallback parser\n' : '';
    await fs.writeFile(path.join(logs, `run-one-${repo}.log`), `${preflight}\n${reuse}\n${unmatchedFallback}`, 'utf8');
    await fs.writeFile(path.join(logs, `run-one-${repo}.diagnostics.jsonl`), `${JSON.stringify({
      eventType: 'parser_crash', eventId: 'one-event', signature: 'one-event', message: 'same event', label: repo === 'all' ? 'repo-a' : repo
    })}\nnot-json\n`, 'utf8');
    await fs.writeFile(path.join(logs, `run-one-${repo}.progress-confidence.jsonl`), `${JSON.stringify({ score: 0.5, bucket: 'medium', label: 'repo-a', ts: '2026-10-22T00:00:00Z' })}\n`, 'utf8');
  }
  await fs.writeFile(path.join(logs, 'nested', 'run-other-all.log'), 'using fallback parser\n');
  const input = { configPath: path.join(root, 'repos.json'), cacheRoot: root, resultsRoot: root, results: [], config: {}, runSuffix: 'one' };
  const output = await buildReportOutput(input);
  assert.equal(output.diagnostics.streamRead.metrics.directoryVisits, 2);
  assert.equal(output.diagnostics.streamRead.metrics.fileOpens, 9, 'each selected physical log/JSONL is opened once');
  assert.equal(output.diagnostics.streamRead.files.length, 9);
  assert.equal(new Set(output.diagnostics.streamRead.files.map(file => file.path)).size, 9);
  assert.equal(output.diagnostics.streamRead.incomplete, false);
  assert.equal(output.diagnostics.streamRead.metrics.bytesRead,
    output.diagnostics.streamRead.files.reduce((sum, file) => sum + file.capturedBytes, 0));
  assert.equal(output.diagnostics.preflight.eventCount, 2, 'distinct repository scopes survive while master duplicate is ignored');
  assert.equal(output.diagnostics.preflight.rawEventCount, 3);
  assert.equal(output.diagnostics.stream.eventCount, 2);
  assert.equal(output.diagnostics.stream.malformedLines, 3);
  assert.equal(output.diagnostics.progressConfidence.eventCount, 1);
  assert.equal(output.diagnostics.reuse.observationCount, 3, 'legacy reuse keeps its own observation definition');
  assert.equal(output.diagnostics.parity.status, 'error', 'independent stream/log discrepancies remain visible');

  const taskSummary = { schemaVersion: 1, observationCount: 1, observations: [{ reuseSurface: 'provider-result', reuseSource: 'cache', causeClass: 'cache_hit' }] };
  const withPayload = await buildReportOutput({ ...input, results: [{ language: 'javascript', tier: 'small', repo: 'repo-a', payload: { scanProfile: { reuse: taskSummary } } }] });
  assert.equal(withPayload.diagnostics.reuse.observationCount, 1, 'task payload remains authoritative for reuse');
  assert.equal(withPayload.diagnostics.streamRead.metrics.fileOpens, 9, 'payload precedence does not add or remove log reads needed by other reducers');

  const transport = path.join(logs, 'run-transport-all.log');
  // Put one multibyte code point across the transport block boundary, and retain a stable EOF line without newline.
  const firstLine = `${' '.repeat(65535)}é中文`;
  await fs.writeFile(transport, `${firstLine}\r\nlast`);
  let inventory = await discoverReportStreams(root, { runSuffix: 'transport' });
  let context = createReportStreamContext(inventory);
  const lines = [];
  const read = await context.consume(transport, line => lines.push(line));
  assert.deepEqual(lines, ['é中文', 'last']);
  assert.equal(read.unterminatedFinalLine, true);
  assert.equal(read.incomplete, false);

  await fs.writeFile(transport, `${'x'.repeat(65)}\nkept`);
  inventory = await discoverReportStreams(root, { runSuffix: 'transport' });
  const boundedLines = [];
  const bounded = await readReportStream(inventory, inventory.entries[0], line => boundedLines.push(line), { maxLineBytes: 64 });
  assert.deepEqual(boundedLines, ['kept']);
  assert.equal(bounded.oversizedLines, 1);
  assert.equal(bounded.incomplete, true, 'oversized input is explicit incomplete evidence');

  await fs.writeFile(transport, 'first\nlast');
  inventory = await discoverReportStreams(root, { runSuffix: 'transport' });
  const appendedLines = [];
  const appended = await readReportStream(inventory, inventory.entries[0], async (line) => {
    appendedLines.push(line);
    if (line === 'first') await fs.appendFile(transport, '\nnew-event\n');
  });
  assert.deepEqual(appendedLines, ['first', 'last'], 'appended bytes are outside the captured boundary');
  assert.equal(appended.reason, 'changed-during-read');
  assert.equal(appended.incomplete, true);
  assert.equal(appended.bytesRead, Buffer.byteLength('first\nlast'));

  await fs.writeFile(transport, 'old contents');
  inventory = await discoverReportStreams(root, { runSuffix: 'transport' });
  await fs.truncate(transport, 1);
  const changed = await readReportStream(inventory, inventory.entries[0], () => assert.fail('changed snapshot must not feed a reducer'));
  assert.equal(changed.reason, 'changed-before-read');
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(readReportStream(inventory, inventory.entries[0], () => {}, { signal: aborted.signal }), { name: 'AbortError' });
  const failure = new Error('reducer failed');
  inventory = await discoverReportStreams(root, { runSuffix: 'transport' });
  await assert.rejects(readReportStream(inventory, inventory.entries[0], () => { throw failure; }), error => error === failure);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
console.log('benchmark single-pass streams controls passed');
