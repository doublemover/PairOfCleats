#!/usr/bin/env node
import { assertSummaryBuildCase } from './summary-build-case-helpers.js';

await assertSummaryBuildCase({ cacheVariant: 'repo', sqliteMode: 'extracted-prose' });
console.log('summary report repository extracted-prose build passed');
