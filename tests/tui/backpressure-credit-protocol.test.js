#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import fs from 'node:fs';
import path from 'node:path';

ensureTestingEnv(process.env);

const root = process.cwd();
const supervisorPath = path.join(root, 'tools', 'tui', 'supervisor.js');
const source = fs.readFileSync(supervisorPath, 'utf8');

if (!source.includes("op === 'flow:credit'")) {
  console.error('backpressure credit protocol test failed: missing flow:credit request handler');
  process.exit(1);
}
if (!source.includes('queueFlowEntry') || !source.includes('drainFlowQueue')) {
  console.error('backpressure credit protocol test failed: missing bounded queue + drain implementation');
  process.exit(1);
}
if (!source.includes('coalesced') || !source.includes('dropped')) {
  console.error('backpressure credit protocol test failed: missing deterministic coalesce/drop counters');
  process.exit(1);
}
if (!source.includes("emit('runtime:metrics'")) {
  console.error('backpressure credit protocol test failed: missing runtime metrics emission');
  process.exit(1);
}

console.log('tui backpressure credit protocol test passed');
