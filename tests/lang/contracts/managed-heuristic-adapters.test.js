#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import { assertHeuristicAdapterCases } from '../helpers/heuristic-adapter-contracts.js';

applyTestEnv();

const CASES = [
  {
    id: 'dart',
    source: [
      "import 'package:app/core.dart';",
      'class WidgetService {',
      '  int run(int value) {',
      '    if (value > 0) return helper(value);',
      '    return 0;',
      '  }',
      '}',
      'int helper(int v) => v;'
    ].join('\n'),
    expectedImport: 'package:app/core.dart',
    expectedExport: 'WidgetService',
    expectedCall: 'helper'
  },
  {
    id: 'groovy',
    source: [
      'import groovy.json.JsonSlurper',
      'class WidgetService {',
      '  def run() {',
      '    if (true) {',
      '      helper()',
      '    }',
      '  }',
      '}',
      'def helper() {',
      "  println 'ok'",
      '}'
    ].join('\n'),
    expectedImport: 'groovy.json.JsonSlurper',
    expectedExport: 'WidgetService',
    expectedCall: 'helper'
  },
  {
    id: 'scala',
    source: [
      'import scala.util.Try',
      'object WidgetService {',
      '  def run(v: Int): Int = {',
      '    if (v > 0) helper(v) else 0',
      '  }',
      '  def helper(value: Int): Int = value',
      '}'
    ].join('\n'),
    expectedImport: 'scala.util.Try',
    expectedExport: 'WidgetService',
    expectedCall: 'helper'
  }
];

assertHeuristicAdapterCases(CASES);

console.log('managed heuristic adapters contract test passed');
