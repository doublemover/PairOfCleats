import assert from 'node:assert/strict';
import { extractSkipReason } from './run-logging.js';

assert.equal(extractSkipReason('[script-coverage] optional-action\nSKIP_REASON: sqlite-vec extension missing\n', ''),
  'sqlite-vec extension missing', 'wrapper labels must not replace the actual capability reason');
assert.equal(extractSkipReason('diagnostic preamble\n', 'SKIP_REASON: Bash workspace is unavailable\n'),
  'Bash workspace is unavailable', 'structured reasons survive stderr forwarding');
assert.equal(extractSkipReason('legacy helper-only reason\n', ''), 'legacy helper-only reason');
assert.equal(extractSkipReason('', ''), 'skipped');
console.log('Skip receipts preserve explicit child reasons and legacy helper fallbacks');
