#!/usr/bin/env node
import { runCli } from '../../build_index.js';

const exitCode = await runCli();
process.exitCode = Number.isFinite(Number(exitCode)) ? Number(exitCode) : 0;
