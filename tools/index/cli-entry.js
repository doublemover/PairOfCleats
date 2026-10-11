#!/usr/bin/env node
import { guardBootstrapEntry } from '../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
const { runCli } = await import('../../build_index.js');

const exitCode = await runCli();
process.exitCode = Number.isFinite(Number(exitCode)) ? Number(exitCode) : 0;
