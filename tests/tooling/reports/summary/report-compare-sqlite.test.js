#!/usr/bin/env node
import { assertCompareModelsSummaryReport } from './summary-report-helpers.js';

await assertCompareModelsSummaryReport({
  label: 'sqlite',
  outFileName: 'compare-sqlite.json',
  args: ['--backend', 'sqlite', '--mode', 'both']
});

console.log('summary report compare (sqlite) test passed');
