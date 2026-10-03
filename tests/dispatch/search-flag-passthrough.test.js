#!/usr/bin/env node
import path from 'node:path';
import { runNode } from '../helpers/run-node.js';
import { applyTestEnv } from '../helpers/test-env.js';

const root = process.cwd();
const cliPath = path.join(root, 'bin', 'pairofcleats.js');
const env = applyTestEnv({ syncProcess: false });

const result = runNode([
  cliPath,
  'search',
  '--help',
  '--backend',
  'tantivy',
  '-n',
  '10'
], 'dispatch search help passthrough', root, env, { stdio: 'pipe' });

if (result.status !== 0) {
  console.error('search passthrough test failed: expected help invocation to succeed');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

if (String(result.stderr || '').includes('Unsupported --backend')) {
  console.error('search passthrough test failed: dispatcher still rejects supported backend');
  process.exit(1);
}

console.log('dispatch search flag passthrough test passed');
