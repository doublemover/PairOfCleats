#!/usr/bin/env node
import { runScriptCoverageGroup } from './group-runner.js';

runScriptCoverageGroup('benchmarks');
console.log('script coverage group benchmarks passed');
