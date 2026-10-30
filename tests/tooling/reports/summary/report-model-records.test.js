#!/usr/bin/env node
import { assertSummaryBuildCase } from './summary-build-case-helpers.js';

await assertSummaryBuildCase({ cacheVariant: 'model', sqliteMode: 'records' });
console.log('summary report model-cache records zero-state build passed');
