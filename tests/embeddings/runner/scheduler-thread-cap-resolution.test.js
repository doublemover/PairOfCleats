#!/usr/bin/env node
import assert from 'node:assert/strict';

import { resolveExplicitThreadsCap } from '../../../tools/build/embeddings/scheduler.js';

assert.equal(
  resolveExplicitThreadsCap({ argv: { threads: 16 }, rawArgv: [] }),
  16,
  'expected argv.threads numeric values to be honored'
);

assert.equal(
  resolveExplicitThreadsCap({ argv: { threads: '12' }, rawArgv: [] }),
  12,
  'expected argv.threads string values to be honored'
);

assert.equal(
  resolveExplicitThreadsCap({ argv: {}, rawArgv: ['--threads', '8'] }),
  8,
  'expected --threads <n> from raw argv to be parsed'
);

assert.equal(
  resolveExplicitThreadsCap({ argv: {}, rawArgv: ['--threads=10'] }),
  10,
  'expected --threads=<n> from raw argv to be parsed'
);

assert.equal(
  resolveExplicitThreadsCap({ argv: {}, rawArgv: ['-j', '6'] }),
  6,
  'expected -j <n> from raw argv to be parsed'
);

assert.equal(
  resolveExplicitThreadsCap({ argv: {}, rawArgv: ['--threads', 'not-a-number'] }),
  null,
  'expected invalid raw argv thread values to be ignored'
);

assert.equal(
  resolveExplicitThreadsCap({ argv: { threads: 14 }, rawArgv: ['--threads', '4'] }),
  14,
  'expected argv.threads to win over raw argv fallback parsing'
);

console.log('scheduler thread cap resolution test passed');
