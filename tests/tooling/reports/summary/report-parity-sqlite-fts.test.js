#!/usr/bin/env node
import { assertParitySummaryReport } from './summary-report-helpers.js';

await assertParitySummaryReport({
  sqliteBackend: 'sqlite-fts',
  outFileName: 'parity-sqlite-fts.json'
});

console.log('summary report parity (sqlite-fts) test passed');
