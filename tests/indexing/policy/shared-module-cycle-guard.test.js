#!/usr/bin/env node
import assert from 'node:assert/strict';

import { findSharedModuleCycles } from '../../../tools/testing/shared-module-cycles.js';

const report = await findSharedModuleCycles({
  root: process.cwd()
});

assert.equal(report.cycleCount, 0, `expected no shared-module cycles, found: ${report.cycles.map((cycle) => cycle.nodes.join(' -> ')).join('; ')}`);

console.log('shared module cycle guard passed');
