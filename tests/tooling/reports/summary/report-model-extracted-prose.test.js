#!/usr/bin/env node
import { assertSummaryBuildCase } from './summary-build-case-helpers.js';

await assertSummaryBuildCase({ cacheVariant: 'model', sqliteMode: 'extracted-prose' });
console.log('summary report model-cache extracted-prose build passed');
