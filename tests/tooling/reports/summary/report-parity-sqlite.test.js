#!/usr/bin/env node
import { assertParitySummaryReport } from './summary-report-helpers.js';

await assertParitySummaryReport({
  sqliteBackend: 'sqlite',
  outFileName: 'parity-sqlite.json'
});

console.log('summary report parity (sqlite) test passed');
