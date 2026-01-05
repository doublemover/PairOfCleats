#!/usr/bin/env node
import { search } from './src/core/index.js';

await search(null, { args: process.argv.slice(2), emitOutput: true });
