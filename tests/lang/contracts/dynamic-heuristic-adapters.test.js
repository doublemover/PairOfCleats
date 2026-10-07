#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import { assertHeuristicAdapterCases } from '../helpers/heuristic-adapter-contracts.js';

applyTestEnv();

const CASES = [
  {
    id: 'julia',
    source: [
      'using JSON',
      'module Widget',
      'function run(v)',
      '  if v > 0',
      '    return helper(v)',
      '  end',
      '  return 0',
      'end',
      'helper(v) = v',
      'end'
    ].join('\n'),
    expectedImport: 'JSON',
    expectedExport: 'Widget',
    expectedCall: 'helper'
  },
  {
    id: 'r',
    source: [
      "library(ggplot2)",
      'run <- function(value) {',
      '  if (value > 0) {',
      '    return(helper(value))',
      '  }',
      '  0',
      '}',
      'helper <- function(v) v'
    ].join('\n'),
    expectedImport: 'ggplot2',
    expectedExport: 'run',
    expectedCall: 'helper'
  }
];

assertHeuristicAdapterCases(CASES);

console.log('dynamic heuristic adapters contract test passed');
