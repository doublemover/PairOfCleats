#!/usr/bin/env node
import { runScriptCoverageGroup } from './group-runner.js';

runScriptCoverageGroup('tools');
console.log('script coverage group tools passed');
