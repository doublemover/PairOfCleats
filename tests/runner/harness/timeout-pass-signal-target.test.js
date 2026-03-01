#!/usr/bin/env node
import { skip } from '../../helpers/skip.js';

const allowRun = process.env.PAIROFCLEATS_TEST_ALLOW_TIMEOUT_PASS_SIGNAL_TARGET === '1'
  || process.env.PAIROFCLEATS_TEST_ALLOW_TIMEOUT_PASS_SIGNAL_TARGET === 'true';
if (!allowRun) {
  skip('timeout pass-signal target is helper-only');
}

console.log('timeout pass-signal target test passed');
setInterval(() => {}, 1000);
