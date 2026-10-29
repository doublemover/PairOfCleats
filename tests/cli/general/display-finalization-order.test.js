import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { Writable } from 'node:stream';
const terminalUrl = new URL('../../../src/shared/cli/display/terminal.js', import.meta.url).href;
const hook = registerHooks({ load(url, context, next) {
  if (url === terminalUrl) return { format: 'module', shortCircuit: true, source:
    `export const normalizeProgressMode = value => value;
    export const resolveWidth = term => term.width;
    export const resolveTerminal = stream => Object.assign(value=>stream.write(value), { hideCursor:()=>stream.write('hide\\n'), showCursor:()=>{stream.write('show\\n');if(globalThis.__throwTerminalCleanup)throw new Error('owned terminal cleanup failure');},
      eraseLine:()=>stream.write('erase\\n'), noFormat:text=>stream.write(text), up:()=>{}, width:80 });` };
  if (url.endsWith('/src/integrations/core/index.js')) return { format: 'module', shortCircuit: true,
    source: "export const buildIndex=async()=>{throw new Error('original build failure')};" };
  return next(url, context);
} });
try {
  const { createDisplay } = await import('../../../src/shared/cli/display.js');
  let text = '';
  const stream = new Writable({ write(chunk, encoding, callback) { text += chunk; callback(); } });
  const display = createDisplay({ stream, isTTY: true, progressMode: 'tty' });
  display.finalize(error => { assert.equal(error, null); stream.write('terminal\n'); });
  display.close();
  assert.equal(text, 'hide\nshow\nerase\nterminal\n');
  assert.equal(text.match(/show/g).length, 1);
  assert.equal(stream.listenerCount('close'), 0);
  assert.equal(stream.listenerCount('finish'), 0);
  globalThis.__throwTerminalCleanup = true;
  let cleanupText = '';
  const failingStream = new Writable({ write(chunk, encoding, callback) { cleanupText += chunk; callback(); } });
  const failing = createDisplay({ stream: failingStream, isTTY: true, progressMode: 'tty' });
  let failure;
  failing.finalize(error => { failure = error; failingStream.write('terminal\n'); }); failing.close();
  assert.match(failure.message, /owned terminal cleanup failure/);
  assert.equal(cleanupText, 'hide\nshow\nerase\nterminal\n');
  assert.equal(failingStream.listenerCount('error'), 0);
  let actualText = '';
  const stderr = new Writable({ write(chunk, encoding, callback) { actualText += chunk; callback(); } }); stderr.isTTY = true;
  const { main } = await import('../../../build_index.js');
  assert.equal(await main({ rawArgs: ['--repo', process.cwd(), '--stage', '3', '--progress', 'tty'], stderr }), 1);
  assert.match(actualText, /original build failure/); assert.match(actualText, /owned terminal cleanup failure/);
  assert.doesNotMatch(actualText, /\[DONE\]/);
  assert.equal(stderr.listenerCount('error'), 0);
} finally { hook.deregister(); delete globalThis.__throwTerminalCleanup; }
console.log('Terminal cleanup precedes output retirement and repeated close is idempotent.');
