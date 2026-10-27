#!/usr/bin/env node
import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
const { parseSimpleBenchArgs } = await import('../shared.js');
const { loadSqliteBenchDatabase } = await import('./shared.js');
const { runSqliteBenchmarkCampaign } = await import('./campaign.js');
await runSqliteBenchmarkCampaign({ Database: await loadSqliteBenchDatabase(), args: parseSimpleBenchArgs(), operation: 'build' });
