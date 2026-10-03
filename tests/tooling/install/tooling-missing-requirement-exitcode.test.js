#!/usr/bin/env node
import { runToolingInstallWithEmptyPath } from './tooling-install-test-helper.js';

const { result, payload } = runToolingInstallWithEmptyPath('gopls');

if (result.status === 0) {
  console.error('tooling-install missing requirement test failed: expected non-zero status');
  process.exit(1);
}

const gopls = Array.isArray(payload?.results)
  ? payload.results.find((entry) => entry?.id === 'gopls')
  : null;
if (!gopls || gopls.status !== 'missing-requirement') {
  console.error('tooling-install missing requirement test failed: expected gopls missing-requirement result');
  process.exit(1);
}
if (!Array.isArray(gopls.requirementChecks) || gopls.requirementChecks.length === 0) {
  console.error('tooling-install missing requirement test failed: expected structured requirementChecks');
  process.exit(1);
}
if (!gopls.requirementChecks.every((entry) => typeof entry?.outcome === 'string' && entry.outcome.length > 0)) {
  console.error('tooling-install missing requirement test failed: expected requirementChecks outcomes');
  process.exit(1);
}

console.log('tooling-install missing requirement exit code test passed');
