import assert from 'node:assert/strict';
import { createJobController } from '../../tools/tui/supervisor/jobs.js';

const events = [];
const state = { jobs: new Map(), shuttingDown: true };
const controller = createJobController({ state, root: process.cwd(), runId: 'shutdown-admission',
  emit: (...event) => events.push(event), emitLog: () => {}, buildFlowSnapshot: () => ({}) });
// Missing argv is intentional: the shutdown fence must run before accepting or
// resolving any command, independently of command validity.
await assert.rejects(controller.startJob({ jobId: 'late-command' }), { code: 'ERR_TUI_SHUTTING_DOWN' });
await assert.rejects(controller.startOperation({ jobId: 'late-settings', method: 'select' },
  () => assert.fail('shutdown must never execute a newly requested operation')), { code: 'ERR_TUI_SHUTTING_DOWN' });
assert.equal(state.jobs.size, 0);
assert.deepEqual(events, []);
console.log('Supervisor rejects new work before admission during shutdown');
