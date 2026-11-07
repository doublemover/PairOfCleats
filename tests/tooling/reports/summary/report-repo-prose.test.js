#!/usr/bin/env node
import { assertSummaryBuildCase } from './summary-build-case-helpers.js';

await assertSummaryBuildCase({ cacheVariant: 'repo', sqliteMode: 'prose' });
console.log('summary report repository prose build passed');
