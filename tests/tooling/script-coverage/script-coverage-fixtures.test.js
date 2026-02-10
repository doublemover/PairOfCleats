#!/usr/bin/env node
import { runScriptCoverageGroup } from './group-runner.js';

runScriptCoverageGroup('fixtures');
console.log('script coverage group fixtures passed');
