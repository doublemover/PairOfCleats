#!/usr/bin/env node
import { runUsrConformanceLevelBaselineValidation } from './conformance-level-baseline.js';

runUsrConformanceLevelBaselineValidation({
  targetLevel: 'C3'
});

console.log('usr C3 baseline validation checks passed');
