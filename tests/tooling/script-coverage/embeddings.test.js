#!/usr/bin/env node
import { runScriptCoverageGroup } from './group-runner.js';

runScriptCoverageGroup('embeddings');
console.log('script coverage group embeddings passed');
