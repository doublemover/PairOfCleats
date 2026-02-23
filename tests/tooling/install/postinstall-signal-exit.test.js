import assert from 'node:assert/strict';
import { exitLikeChildResult } from '../../../tools/setup/postinstall-exit.js';

const events = [];
const fakeProc = {
  pid: 4242,
  exit(code) {
    events.push({ type: 'exit', code });
  },
  kill(pid, signal) {
    events.push({ type: 'kill', pid, signal });
  }
};

exitLikeChildResult({ status: null, signal: 'SIGINT' }, fakeProc);
assert.deepEqual(events, [{ type: 'kill', pid: 4242, signal: 'SIGINT' }]);

events.length = 0;
exitLikeChildResult({ status: 7, signal: null }, fakeProc);
assert.deepEqual(events, [{ type: 'exit', code: 7 }]);

events.length = 0;
exitLikeChildResult({ status: null, signal: null }, fakeProc);
assert.deepEqual(events, [{ type: 'exit', code: 1 }]);

console.log('postinstall signal-exit contract test passed');
