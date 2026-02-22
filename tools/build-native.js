#!/usr/bin/env node
import { NATIVE_ACCEL_DECISION } from '../src/shared/native-accel.js';

const payload = {
  ok: true,
  mode: 'no-go',
  decision: NATIVE_ACCEL_DECISION
};

console.log(JSON.stringify(payload, null, 2));
