import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runBootstrapTasks } from '../../tools/setup/bootstrap-tasks.js';
import { formatBootstrapTaskProgress } from '../../tools/setup/task-progress.js';
import { writeBootstrapStatus, writeBootstrapDiagnosticBytes } from '../../tools/setup/task-progress-output.js';
import { withCheckoutMutation } from '../../tools/setup/checkout-mutation.js';
import { withCheckoutStageJournal } from '../../tools/setup/checkout-stage-journal.js';
import { CHECKOUT_MUTATION_LOCK } from '../../tools/setup/checkout-bootstrap-paths.js';

const [receiptPath, mode] = process.argv.slice(2), root = path.dirname(receiptPath);
assert.ok(path.isAbsolute(receiptPath)); assert.ok(['pty', 'pipe'].includes(mode));
const writes = [], events = [], originalWrite = process.stderr.write;
process.stderr.write = function (chunk, ...args) {
  writes.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk, 'utf8'));
  return originalWrite.call(this, chunk, ...args);
};
let outcome;
try {
  outcome = await withCheckoutMutation(root, session => withCheckoutStageJournal(root, session,
    { root, stages: [{ id: 'terminal-status' }] }, journal => journal.runStage('terminal-status', async () => {
      const result = await runBootstrapTasks([
        { id: 'compiler', run: async () => ({ ok: true }) },
        { id: 'probe', dependsOn: ['compiler'], run: async () => ({ ok: true }) },
        { id: 'optional', required: false, run: async () => ({ ok: false, message: 'expected optional fixture unavailable' }) }
      ], { budget: { jobs: 2, cpuCount: 2, memoryBytes: 1024 }, eventContext: { runId: session.runId, planId: journal.planId },
        onEvent: event => {
          events.push(event); const line = formatBootstrapTaskProgress(event, 'terminal');
          if (line) return writeBootstrapStatus(line, process.stderr, { root, session });
        } });
      assert.equal(result.ok, true); return { ok: true, results: result.results };
    })));
} finally { process.stderr.write = originalWrite; }
const summary = { kind: 'bootstrap-terminal-status-fixture', platform: process.platform, pid: process.pid, mode,
  runtime: { node: process.version, abi: process.versions.modules, executable: process.execPath },
  stdoutTTY: Boolean(process.stdout.isTTY), stderrTTY: Boolean(process.stderr.isTTY),
  columns: process.stdout.columns ?? null, rows: process.stdout.rows ?? null,
  noColor: process.env.NO_COLOR === '1', rootRetired: !fs.existsSync(path.join(root, CHECKOUT_MUTATION_LOCK)),
  rawStatus: Buffer.concat(writes).toString('utf8'), states: outcome.results.map(row => ({ id: row.id, status: row.status })),
  emittedStates: events.map(row => ({ id: row.taskId, state: row.state })), sentinel: 'BOOTSTRAP-STATUS-DONE' };
fs.writeFileSync(receiptPath, JSON.stringify(summary));
await writeBootstrapDiagnosticBytes(Buffer.from(JSON.stringify({ kind: summary.kind, sentinel: summary.sentinel }) + '\n'), process.stdout);
