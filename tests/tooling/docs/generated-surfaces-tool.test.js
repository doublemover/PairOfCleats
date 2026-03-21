#!/usr/bin/env node
import { ensureTestingEnv } from '../../helpers/test-env.js';
import path from 'node:path';
import { execaSync } from 'execa';

ensureTestingEnv(process.env);

const root = process.cwd();
const toolPath = path.join(root, 'tools', 'docs', 'generated-surfaces.js');

const checkResult = execaSync('node', [toolPath, '--check'], { cwd: root });
if (!checkResult.stdout.includes('generated surfaces registry check passed')) {
  console.error('generated surfaces tool test failed: --check output missing success marker');
  process.exit(1);
}

const jsonResult = execaSync('node', [toolPath, '--json'], { cwd: root });
const payload = JSON.parse(jsonResult.stdout);
if (!Array.isArray(payload?.surfaces) || payload.surfaces.length < 6) {
  console.error('generated surfaces tool test failed: expected populated surfaces array');
  process.exit(1);
}

console.log('generated surfaces tool test passed');
