#!/usr/bin/env node
import { runScriptCoverageGroup } from './group-runner.js';

runScriptCoverageGroup('language');
console.log('script coverage group language passed');
