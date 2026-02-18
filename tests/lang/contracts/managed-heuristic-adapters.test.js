#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { LANGUAGE_REGISTRY } from '../../../src/index/language-registry/registry-data.js';

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

for (const testCase of CASES) {
  const entry = LANGUAGE_REGISTRY.find((row) => row.id === testCase.id);
  assert.ok(entry, `missing registry entry for ${testCase.id}`);
  assert.equal(entry.capabilityProfile, undefined, `${testCase.id} should not be marked as import-collector downgrade`);

  const relations = entry.buildRelations({ text: testCase.source, options: {} }) || {};
  assert.ok(Array.isArray(relations.imports), `${testCase.id} should emit imports array`);
  assert.ok(relations.imports.includes(testCase.expectedImport), `${testCase.id} should keep expected import`);
  assert.ok(Array.isArray(relations.exports), `${testCase.id} should emit exports array`);
  assert.ok(relations.exports.includes(testCase.expectedExport), `${testCase.id} should emit at least one exported symbol`);
  assert.ok(Array.isArray(relations.usages), `${testCase.id} should emit usages array`);
  assert.ok(relations.usages.includes(testCase.expectedCall), `${testCase.id} should emit heuristic call usage`);
  assert.ok(Array.isArray(relations.calls), `${testCase.id} should emit calls array`);
  assert.ok(relations.calls.some((entryCall) => Array.isArray(entryCall) && entryCall[1] === testCase.expectedCall), `${testCase.id} should emit call edges`);

  const chunk = {
    name: testCase.expectedExport,
    start: 0,
    end: testCase.source.length
  };
  const docmeta = entry.extractDocMeta({ chunk });
  assert.equal(docmeta?.symbol, testCase.expectedExport, `${testCase.id} should emit heuristic docmeta symbol`);

  const flow = entry.flow({
    text: testCase.source,
    chunk,
    options: { astDataflowEnabled: true, controlFlowEnabled: true }
  });
  assert.ok(flow && flow.controlFlow, `${testCase.id} should emit control flow summary`);
  assert.equal(typeof flow.controlFlow.branches, 'number', `${testCase.id} controlFlow.branches must be numeric`);
}

console.log('managed heuristic adapters contract test passed');
