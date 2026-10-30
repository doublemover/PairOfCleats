#!/usr/bin/env node
import { assertSummaryBuildCase } from './summary-build-case-helpers.js';

await assertSummaryBuildCase({ cacheVariant: 'model', sqliteMode: 'prose' });
console.log('summary report model-cache prose build passed');
