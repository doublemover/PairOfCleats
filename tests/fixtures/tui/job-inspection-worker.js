import { formatProgressEvent } from '../../../src/shared/cli/progress-events.js';

const mode = process.argv[2];
if (mode === 'invalid-json') process.stdout.write('{invalid-json');
else if (mode === 'truncated') process.stdout.write(JSON.stringify({ value: 'x'.repeat(2048) }));
else if (mode === 'oversized') process.stdout.write(JSON.stringify({ value: 'PRIVATE_INSPECTION_BODY_' + 'x'.repeat(300 * 1024) }));
else if (mode === 'incomplete') {
  process.stdout.write('{');
  process.stderr.write(JSON.stringify(formatProgressEvent('task:progress', {
    taskId: 'inspection-partial', stage: 'fixture', completed: 1, total: 2
  })) + '\n');
  setInterval(() => {}, 1000);
} else throw new Error('Explicit inspection fixture mode required');
