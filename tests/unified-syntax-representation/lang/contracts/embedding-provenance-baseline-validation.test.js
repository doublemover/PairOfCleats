#!/usr/bin/env node
import { runUsrConformanceLevelBaselineValidation } from './conformance-level-baseline.js';

runUsrConformanceLevelBaselineValidation({
  targetLevel: 'C2'
});

console.log('usr C2 baseline validation checks passed');
