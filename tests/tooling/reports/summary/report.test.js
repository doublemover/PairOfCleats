#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { ensureSummaryReportFixture } from './summary-report-helpers.js';

const { tempRoot } = await ensureSummaryReportFixture();
const markerPath = path.join(tempRoot, 'build-complete.json');
if (!fs.existsSync(markerPath)) {
  console.error('summary report build test failed: build marker missing.');
  process.exit(1);
}

console.log('summary report build test passed');

