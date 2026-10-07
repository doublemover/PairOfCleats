#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import { createSupervisorSession } from '../helpers/supervisor-session.js';
import assert from 'node:assert/strict';

ensureTestingEnv(process.env);

const { waitForEvent, shutdown, forceKill } = createSupervisorSession();

try {
  const hello = await waitForEvent((event) => event.event === 'hello');
  assert.equal(hello.session?.mode, 'supervised');
  assert.equal(hello.session?.source, 'local-supervisor');
  assert.equal(hello.session?.connection, 'connected');
  assert.equal(hello.session?.controllable, true);
  assert.equal(typeof hello.session?.scope, 'string');
  assert.notEqual(String(hello.session?.scope || '').trim(), '', 'expected non-empty session scope');

  await shutdown();

  console.log('tui session runtime model test passed');
} catch (error) {
  forceKill();
  console.error(error?.message || error);
  process.exit(1);
}
