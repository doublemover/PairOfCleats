import { ensureTestingEnv } from '../helpers/test-env.js';
import { createSupervisorSession } from '../helpers/supervisor-session.js';

ensureTestingEnv(process.env);

export const createSupervisorProtocolFixture = (options = {}) => {
  const session = createSupervisorSession(options);
  return {
    child: session.child,
    events: session.events,
    kill: session.forceKill,
    send: session.send,
    waitForEvent: session.waitForEvent,
    waitForExit: session.waitForExit
  };
};
