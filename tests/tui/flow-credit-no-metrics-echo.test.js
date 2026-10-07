#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import assert from 'node:assert/strict';
import { createSupervisorSession } from '../helpers/supervisor-session.js';

ensureTestingEnv(process.env);

const { events, waitForEvent, send, shutdown, forceKill } = createSupervisorSession();

try {
  await waitForEvent((event) => event.event === 'hello');
  await waitForEvent((event) => event.event === 'runtime:metrics');
  const initialCount = events.filter((event) => event.event === 'runtime:metrics').length;

  send({ op: 'flow:credit', credits: 64 });
  await new Promise((resolve) => setTimeout(resolve, 250));

  const nextCount = events.filter((event) => event.event === 'runtime:metrics').length;
  assert.equal(
    nextCount,
    initialCount,
    'flow:credit should not trigger an immediate extra runtime:metrics echo'
  );

  await shutdown();
  console.log('tui flow credit no metrics echo test passed');
} catch (error) {
  forceKill();
  console.error(error?.message || error);
  process.exit(1);
}
