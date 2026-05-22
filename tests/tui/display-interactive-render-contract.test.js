#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import assert from 'node:assert/strict';

import { renderDisplay } from '../../src/shared/cli/display/render.js';
import {
  applyDisplayTaskUpdate,
  createDisplayState,
  ensureDisplayTask
} from '../../src/shared/cli/display/state.js';

ensureTestingEnv(process.env);

const state = createDisplayState();
state.logLines.push('starting');

const { task } = ensureDisplayTask(state, 'files', 'Files', {
  stage: 'processing',
  mode: 'extracted-prose',
  total: 10,
  unit: 'files',
  message: 'src/index.js'
}, 1000);
applyDisplayTaskUpdate(task, { current: 5, message: 'src/index.js', status: 'done' }, 2000);

const writes = [];
const term = (chunk) => {
  writes.push(String(chunk));
};
term.width = 96;
term.up = (count) => writes.push(`<up:${count}>`);
term.down = (count) => writes.push(`<down:${count}>`);
term.eraseLine = () => writes.push('<erase>');

renderDisplay({
  state,
  term,
  stream: { columns: 96 },
  interactive: true,
  canRender: true,
  colorEnabled: false,
  logWindowSize: 3
});

assert.equal(state.rendered, true, 'expected first render to initialize frame state');
assert.ok(state.renderFrame.some((line) => line.includes('Extracted Prose Files')), 'expected task label in frame');
assert.ok(state.renderFrame.some((line) => line.includes('5/10')), 'expected progress suffix in frame');

const writeCountAfterFirstRender = writes.length;
renderDisplay({
  state,
  term,
  stream: { columns: 96 },
  interactive: true,
  canRender: true,
  colorEnabled: false,
  logWindowSize: 3
});

assert.equal(writes.length, writeCountAfterFirstRender, 'unchanged frame should not rewrite rows');

console.log('display interactive render contract test passed');
