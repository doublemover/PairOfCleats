#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const ciLiteOrderPath = path.join(root, 'tests', 'ci-lite', 'ci-lite.order.txt');
const ciOrderPath = path.join(root, 'tests', 'ci', 'ci.order.txt');

const readText = (filePath) => fs.readFileSync(filePath, 'utf8');

const toLaneId = (testPath) => testPath
  .replace(/\\/g, '/')
  .replace(/^tests\//, '')
  .replace(/\.test\.js$/, '');

const ciLiteEntries = new Set(
  readText(ciLiteOrderPath)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
);
const ciEntries = new Set(
  readText(ciOrderPath)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
);

const matrix = [
  {
    editor: 'vscode',
    flow: 'search smoke harness',
    testPath: 'tests/tooling/vscode/integration-harness.test.js',
    requiredContent: [
      'pairofcleats.search',
      'nested symbol',
      'searchHistory'
    ],
    requiredLanes: ['ci-lite']
  },
  {
    editor: 'vscode',
    flow: 'index and validate harness',
    testPath: 'tests/tooling/vscode/operations-runtime.test.js',
    requiredContent: [
      'pairofcleats.indexValidate',
      'Index Validate completed.'
    ],
    requiredLanes: ['ci-lite']
  },
  {
    editor: 'vscode',
    flow: 'context-pack and risk-explain harness',
    testPath: 'tests/tooling/vscode/context-risk-runtime.test.js',
    requiredContent: [
      'pairofcleats.contextPack',
      'pairofcleats.riskExplain',
      'Context Pack completed.',
      'Risk Explain completed.'
    ],
    requiredLanes: ['ci-lite']
  },
  {
    editor: 'sublime',
    flow: 'search harness',
    testPath: 'tests/tooling/sublime/search-behavior.test.js',
    requiredContent: [
      'sublime search behavior test passed'
    ],
    requiredLanes: ['ci-lite']
  },
  {
    editor: 'sublime',
    flow: 'index harness',
    testPath: 'tests/tooling/sublime/index-behavior.test.js',
    requiredContent: [
      'sublime index behavior test passed'
    ],
    requiredLanes: ['ci-lite']
  },
  {
    editor: 'sublime',
    flow: 'context-pack and risk-explain harness',
    testPath: 'tests/tooling/sublime/analysis-behavior.test.js',
    requiredContent: [
      'sublime analysis behavior test passed'
    ],
    requiredLanes: ['ci-lite']
  },
  {
    editor: 'sublime',
    flow: 'fixture-backed package harness',
    testPath: 'tests/tooling/sublime/package-harness.test.js',
    requiredContent: [
      'sublime package harness test passed'
    ],
    requiredLanes: ['ci']
  },
  {
    editor: 'sublime',
    flow: 'real package harness implementation',
    testPath: 'tests/helpers/sublime/package_harness.py',
    requiredContent: [
      'test_package_harness_exercises_real_search_index_map_and_advanced_workflows',
      'PairOfCleatsIndexBuildCodeCommand',
      'PairOfCleatsSearchCommand',
      'PairOfCleatsArchitectureCheckCommand'
    ],
    requiredLanes: []
  }
];

for (const entry of matrix) {
  const absolutePath = path.join(root, entry.testPath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`missing ${entry.editor} ${entry.flow} harness: ${absolutePath}`);
    process.exit(1);
  }
  const source = readText(absolutePath);
  for (const required of entry.requiredContent) {
    if (!source.includes(required)) {
      console.error(`${entry.editor} ${entry.flow} harness missing expected marker "${required}" in ${entry.testPath}`);
      process.exit(1);
    }
  }
  const laneId = toLaneId(entry.testPath);
  for (const lane of entry.requiredLanes) {
    const targetSet = lane === 'ci-lite' ? ciLiteEntries : ciEntries;
    if (!targetSet.has(laneId)) {
      console.error(`${entry.editor} ${entry.flow} harness is not registered in ${lane}: ${laneId}`);
      process.exit(1);
    }
  }
}

console.log('editor harness coverage contract test passed');
