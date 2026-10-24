#!/usr/bin/env node
import { assertSummaryBuildCase } from './summary-build-case-helpers.js';

await assertSummaryBuildCase({ cacheVariant: 'repo', sqliteMode: 'code', coreIndex: true });
console.log('summary report repository code build passed');

