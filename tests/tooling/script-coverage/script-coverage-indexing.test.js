#!/usr/bin/env node
import { runScriptCoverageGroup } from './group-runner.js';

runScriptCoverageGroup('indexing');
console.log('script coverage group indexing passed');
