#!/usr/bin/env node
import { resolveBenchmarkProfile } from '../src/shared/bench-profile.js';

const enabledByProfile = resolveBenchmarkProfile('bench-index');
if (!enabledByProfile.enabled) {
  throw new Error('Expected bench-index profile to enable benchmark profile defaults.');
}
const disabledByProfile = resolveBenchmarkProfile('full');
if (disabledByProfile.enabled) {
  throw new Error('Expected non-bench profile to disable benchmark profile defaults.');
}

console.log('Bench profile test passed');
