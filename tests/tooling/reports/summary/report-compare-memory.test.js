#!/usr/bin/env node
import { assertCompareModelsSummaryReport } from './summary-report-helpers.js';

await assertCompareModelsSummaryReport({
  label: 'memory',
  outFileName: 'compare-memory.json',
  args: ['--mode', 'code']
});

console.log('summary report compare (memory) test passed');
