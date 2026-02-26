#!/usr/bin/env node
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ensureTestingEnv } from '../helpers/test-env.js';
import { createDisplay } from '../../src/shared/cli/display.js';

ensureTestingEnv(process.env);

class MemoryStream extends EventEmitter {
  constructor() {
    super();
    this.isTTY = false;
    this.destroyed = false;
    this.writableEnded = false;
  }

  write() {
    return true;
  }
}

const stream = new MemoryStream();
const display = createDisplay({
  stream,
  progressMode: 'log'
});

const task = display.task('shape-guard', { stage: 'indexing', taskId: 'shape-guard-task' });
task.tick(1);
assert.doesNotThrow(
  () => display.resetTasks({ preserveStages: { stage: 'indexing' }, preserveIds: { id: 'shape-guard-task' } }),
  'resetTasks should tolerate malformed preserve lists'
);
display.close();

console.log('display reset shape guard test passed');
