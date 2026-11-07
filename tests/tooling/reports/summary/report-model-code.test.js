#!/usr/bin/env node
import { assertSummaryBuildCase } from './summary-build-case-helpers.js';

await assertSummaryBuildCase({ cacheVariant: 'model', sqliteMode: 'code' });
console.log('summary report model-cache code build passed');
