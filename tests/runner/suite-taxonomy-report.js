import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { discoverTests } from './run-discovery.js';
import { loadRunRules } from './run-config.js';
import { loadLaneManifestConfig, loadOrderedLaneManifest } from './lane-manifests.js';
import { buildSuiteCategorySummary, inferSuiteCategory, TEST_SUITE_CATEGORIES } from './suite-taxonomy.js';
import { loadConsolidationOwnership } from './consolidation-ownership.js';

const toPosix = (value) => String(value || '').replace(/\\/g, '/');

const PERIPHERAL_GROUPS = Object.freeze([
  { key: 'tooling/install', prefix: 'tooling/install/' },
  { key: 'tooling/vscode', prefix: 'tooling/vscode/' },
  { key: 'tooling/sublime', prefix: 'tooling/sublime/' },
  { key: 'tooling/config-inventory', prefix: 'tooling/config-inventory/' }
]);

const toCategorySummary = (tests) => buildSuiteCategorySummary(
  tests.map((test) => ({ suiteCategory: test.suiteCategory }))
);

const countKnown = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export const buildSuiteTaxonomyReport = ({
  tests = [],
  manifests = new Map(),
  ownership = { suites: [] }
} = {}) => {
  const peripheralGroups = PERIPHERAL_GROUPS.map((group) => {
    const matching = tests.filter((test) => test.id.startsWith(group.prefix));
    return {
      key: group.key,
      totalTests: matching.length,
      byCategory: toCategorySummary(matching)
    };
  });

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    summary: {
      totalTests: tests.length,
      byCategory: toCategorySummary(tests),
      peripheralGroups: peripheralGroups.length,
      ownershipSuites: ownership.suites.length,
      replacementIds: ownership.suites.reduce((sum, entry) => sum + entry.replacementIds.length, 0)
    },
    lanes: Array.from(manifests.entries()).map(([lane, manifest]) => ({
      lane,
      totalTests: Array.isArray(manifest?.tests) ? manifest.tests.length : 0,
      byCategory: manifest?.suiteCategorySummary || Object.fromEntries(TEST_SUITE_CATEGORIES.map((category) => [category, 0]))
    })),
    peripheralGroups,
    ownership: {
      suites: ownership.suites.map((entry) => ({
        id: entry.id,
        suiteCategory: entry.suiteCategory,
        coverageOwner: entry.coverageOwner,
        replacementIds: entry.replacementIds,
        overlapPolicy: entry.overlapPolicy,
        matrixStrategy: entry.matrixStrategy,
        processIsolationRequired: entry.processIsolationRequired
      }))
    }
  };
};

const renderMarkdown = ({ report, ownershipPath, root }) => {
  const lines = [
    '# Suite Taxonomy Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Summary',
    '',
    ...Object.entries(report.summary.byCategory).map(([category, count]) => `- \`${category}\`: ${count}`),
    `- ownership suites tracked: ${report.summary.ownershipSuites}`,
    `- replacement ids tracked: ${report.summary.replacementIds}`,
    '',
    '## Lane Category Summary',
    ''
  ];
  for (const lane of report.lanes) {
    lines.push(`- \`${lane.lane}\`: ${lane.totalTests} tests`);
    for (const [category, count] of Object.entries(lane.byCategory)) {
      if (!countKnown(count)) continue;
      lines.push(`  ${category}: ${count}`);
    }
  }
  lines.push('', '## Peripheral Tooling Groups', '');
  for (const group of report.peripheralGroups) {
    lines.push(`- \`${group.key}\`: ${group.totalTests} tests`);
    for (const [category, count] of Object.entries(group.byCategory)) {
      if (!countKnown(count)) continue;
      lines.push(`  ${category}: ${count}`);
    }
  }
  lines.push('', '## Coverage Ownership', '', `- source: \`${toPosix(path.relative(root, ownershipPath))}\``, '');
  for (const entry of report.ownership.suites) {
    lines.push(`- \`${entry.id}\` -> ${entry.coverageOwner}`);
    lines.push(`  replacements: ${entry.replacementIds.join(', ')}`);
    lines.push(`  overlap policy: ${entry.overlapPolicy}`);
    lines.push(`  matrix strategy: ${entry.matrixStrategy}`);
    lines.push(`  process isolation required: ${entry.processIsolationRequired ? 'yes' : 'no'}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
};

export const generateSuiteTaxonomyReport = async ({
  root = process.cwd(),
  outputJsonPath = path.join(process.cwd(), 'docs', 'testing', 'suite-taxonomy.json'),
  outputMarkdownPath = path.join(process.cwd(), 'docs', 'testing', 'suite-taxonomy.md')
} = {}) => {
  const runRules = loadRunRules({ root });
  const discovered = await discoverTests({
    testsDir: path.join(root, 'tests'),
    excludedDirs: runRules.excludedDirs,
    excludedFiles: runRules.excludedFiles
  });
  const tests = discovered.map((test) => ({
    ...test,
    suiteCategory: inferSuiteCategory({ id: test.id }).category
  }));
  const manifestConfig = await loadLaneManifestConfig({ root });
  const manifests = new Map();
  for (const lane of manifestConfig.orderedLanes.keys()) {
    const manifest = await loadOrderedLaneManifest({ root, lane, config: manifestConfig });
    if (manifest) manifests.set(lane, manifest);
  }
  const ownership = await loadConsolidationOwnership({ root });
  const report = buildSuiteTaxonomyReport({
    tests,
    manifests,
    ownership: ownership.payload
  });

  await fsPromises.mkdir(path.dirname(outputJsonPath), { recursive: true });
  await fsPromises.writeFile(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fsPromises.mkdir(path.dirname(outputMarkdownPath), { recursive: true });
  await fsPromises.writeFile(
    outputMarkdownPath,
    renderMarkdown({ report, ownershipPath: ownership.path, root }),
    'utf8'
  );

  return {
    report,
    outputJsonPath,
    outputMarkdownPath,
    ownershipPath: ownership.path
  };
};
