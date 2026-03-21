#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import fs from 'node:fs';
import path from 'node:path';

ensureTestingEnv(process.env);

const root = process.cwd();
const mainPath = path.join(root, 'crates', 'pairofcleats-tui', 'src', 'main.rs');
const source = fs.readFileSync(mainPath, 'utf8');
const runtimeMetricsIndex = source.indexOf('if event_name == "runtime:metrics"');
const logPushIndex = source.indexOf('model.push_log_entry(log_line, &log_level, &log_source);');
const runtimeReturnIndex = source.indexOf('return;', runtimeMetricsIndex);

if (runtimeMetricsIndex === -1) {
  console.error('runtime metrics log suppression test failed: missing runtime metrics branch');
  process.exit(1);
}
if (logPushIndex === -1) {
  console.error('runtime metrics log suppression test failed: missing generic log sink');
  process.exit(1);
}
if (runtimeReturnIndex === -1 || runtimeReturnIndex > logPushIndex) {
  console.error('runtime metrics log suppression test failed: runtime metrics should bypass the generic log sink');
  process.exit(1);
}

console.log('tui runtime metrics log suppression test passed');
