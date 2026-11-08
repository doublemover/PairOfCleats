#!/usr/bin/env node
import { assertSummaryBuildCase } from './summary-build-case-helpers.js';

await assertSummaryBuildCase({ cacheVariant: 'repo', sqliteMode: 'records' });
console.log('summary report repository records zero-state build passed');
