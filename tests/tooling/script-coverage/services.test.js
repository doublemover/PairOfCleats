#!/usr/bin/env node
import { runScriptCoverageGroup } from './group-runner.js';

runScriptCoverageGroup('services');
console.log('script coverage group services passed');
