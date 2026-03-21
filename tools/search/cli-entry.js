#!/usr/bin/env node
import { runCli } from '../../src/retrieval/cli/search-entry.js';

const exitCode = await runCli();
process.exitCode = Number.isFinite(Number(exitCode)) ? Number(exitCode) : 0;
