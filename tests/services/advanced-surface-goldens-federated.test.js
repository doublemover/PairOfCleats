#!/usr/bin/env node
process.env.POC_ADVANCED_GOLDEN_SECTION = 'federated';
await import('./advanced-surface-goldens.test.js');
