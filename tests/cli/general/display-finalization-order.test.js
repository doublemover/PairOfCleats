import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { Writable } from 'node:stream';
const terminalUrl = new URL('../../../src/shared/cli/display/terminal.js', import.meta.url).href;
const hook = registerHooks({ load(url, context, next) {
  if (url === terminalUrl) return { format: 'module', shortCircuit: true, source:
    `export const normalizeProgressMode = value => value;
    export const resolveWidth = term => term.width;
    export const resolveTerminal = stream => ({ hideCursor:()=>stream.write('hide\\n'), showCursor:()=>stream.write('show\\n'),
      eraseLine:()=>stream.write('erase\\n'), up:()=>{}, width:80 });` };
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
} finally { hook.deregister(); }
console.log('Terminal cleanup precedes output retirement and repeated close is idempotent.');
