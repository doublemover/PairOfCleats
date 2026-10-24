import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { ensureTestingEnv } from '../helpers/test-env.js';
import { createSupervisorSession } from '../helpers/supervisor-session.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';

ensureTestingEnv(process.env);
const activeTimers = () => process.getActiveResourcesInfo().filter(type => type === 'Timeout').length;
const baseline = activeTimers();
const session = createSupervisorSession();
try {
  await session.waitForEvent(event => event.event === 'hello');
  assert.equal(await session.shutdown(), 0);
  await setImmediate();
  assert.equal(activeTimers(), baseline, 'successful shutdown must clear its losing deadline timer, not retain the fixture for eight seconds');
} finally { session.forceKill(); }
const { dir } = await prepareIsolatedTestCacheDir('supervisor-session-deadline');
await fs.mkdir(path.join(dir, 'tools/tui'), { recursive: true });
await fs.writeFile(path.join(dir, 'tools/tui/supervisor.js'),
  `process.stdout.write(JSON.stringify({event:'hello'})+'\\n');process.stdin.resume();setInterval(()=>{},1000);`);
const unresponsive = createSupervisorSession({ root: dir });
try {
  await unresponsive.waitForEvent(event => event.event === 'hello');
  assert.notEqual(await unresponsive.shutdown('explicit-unresponsive-fixture', 50), 0,
    'a genuinely unresponsive child still reaches forced termination');
  assert.ok(unresponsive.child.exitCode !== null || unresponsive.child.signalCode !== null);
  await setImmediate();
  assert.equal(activeTimers(), baseline, 'the expired deadline also leaves no active timer');
} finally { unresponsive.forceKill(); }
console.log('Supervisor session shutdown releases its deadline timer after child exit');
