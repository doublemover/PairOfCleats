import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { search } from '../../../src/integrations/core/search.js';
import { getIndexDir, getTriageConfig, loadUserConfig } from '../../../src/shared/dict-utils.js';
import { loadJsonArrayArtifactRows } from '../../../src/shared/artifact-io/loaders.js';
import { loadTriageRecordSnapshot } from '../../../tools/triage/record-snapshot.js';
import { assertTriageHistorySelection } from '../../../src/contracts/validators/triage-history.js';
import { TRIAGE_RENDERER_VERSION } from '../../../src/contracts/triage-record-publication.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../../../src/index/semantic/analysis-versions.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/triage/inspector-index-filter-context-consumer/')[1];
assert.ok(['multi-package', 'legacy-empty'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir('triage-package-consumer-' + selected);
const repo = path.join(dir, 'repo'); await fs.mkdir(repo);
const input = path.join(dir, 'import.json');
await fs.writeFile(path.join(repo, '.pairofcleats.json'), '{}');
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'stub',
  testConfig: createFastIndexingTestConfig({ threads: 1, indexing: { embeddings: { enabled: false }, semantic: { enabled: false } } }),
  extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const { recordsDir } = getTriageConfig(repo, loadUserConfig(repo));
let invocation = 0;
const invoke = async (script, args) => {
  const argv = process.argv, log = console.log, exit = process.exitCode, output = [];
  process.argv = [argv[0], script, '--repo', repo, ...args];
  console.log = (...values) => output.push(values.join(' '));
  try {
    await import(new URL('../../../tools/triage/' + script + '?consumer=' + selected + '-' + invocation++, import.meta.url));
    assert.ok(process.exitCode === undefined || process.exitCode === 0, output.join('\n'));
    return JSON.parse(output.join('\n'));
  } finally { process.argv = argv; console.log = log; process.exitCode = exit; }
};
const ingest = async (source, entries) => {
  await fs.writeFile(input, JSON.stringify(entries));
  const result = await invoke('ingest.js', ['--source', source, '--in', input]);
  assert.equal(result.errors, 0); assert.equal(result.written, entries.length);
  return result;
};
const snapshot = recordId => loadTriageRecordSnapshot(recordsDir, recordId);
const saveDecision = async recordId => {
  const result = await invoke('decision.js', ['--finding', recordId, '--status', 'accept',
    '--justification', 'Package collection observation', '--reviewer', 'fixture@example.invalid']);
  const stored = await snapshot(result.recordId);
  assert.equal(stored.record.decision.findingRecordId, recordId);
  assert.ok(stored.record.decision.findingObservation);
  return { ...result, stored };
};
const context = async recordId => {
  const out = path.join(dir, 'context-' + recordId + '.json');
  const report = await invoke('context-pack.js', ['--record', recordId, '--out', out, '--no-ann', '--stub-embeddings']);
  assert.equal(report.outPath, out);
  const pack = JSON.parse(await fs.readFile(out, 'utf8'));
  assert.equal(pack.recordId, recordId); assertTriageHistorySelection(pack.historySelection);
  return pack;
};
const filteredIds = {};
const filter = async (query, packageName) => {
  const result = await search(repo, { query, argsMode: 'complete',
    args: ['--mode', 'records', '--backend', 'memory', '--no-ann', '--json', '-n', '20', '--meta', 'packageName=' + packageName],
    emitOutput: false, exitOnError: false });
  assert.ok(Array.isArray(result.records));
  const ids = result.records.map(hit => {
    const record = hit.docmeta?.record;
    assert.ok(record?.recordId);
    assert.ok([record.packageName].flat().includes(packageName), 'actual package metadata admission retains the requested association');
    return record.recordId;
  });
  filteredIds[packageName] = ids;
  return ids;
};
try {
  let findings, saved, wantedPackages, related;
  if (selected === 'multi-package') {
    const packages = [
      { name: 'alphaunique', version: '1.0', filePath: '/alpha/package-lock.json', fixedInVersion: '1.1', packageManager: 'NPM' },
      { name: 'zetaunique', version: '2.0', filePath: '/second/package-lock.json', fixedInVersion: '2.2', packageManager: 'NPM' },
      { name: 'zetaunique', version: '3.0', filePath: '/third/package-lock.json', fixedInVersion: '3.3', packageManager: 'NPM' }
    ];
    const primary = { findingArn: 'fixture:all-package-occurrences', firstObservedAt: 1704067200, lastObservedAt: 1704067201,
      title: 'All affected package evidence', packageVulnerabilityDetails: { vulnerabilityId: 'CVE-2099-1111',
        vulnerablePackages: [...packages, packages[1], null, { version: 'missing-name' }] } };
    const other = { findingArn: 'fixture:nonrepresentative-only', firstObservedAt: 1704067200, lastObservedAt: 1704067201,
      title: 'Related nonrepresentative package', packageVulnerabilityDetails: { vulnerabilityId: 'CVE-2099-2222',
        vulnerablePackages: [packages[1]] } };
    const first = await ingest('aws_inspector', [primary, other]);
    findings = await Promise.all(first.recordIds.map(snapshot)); related = findings[1];
    wantedPackages = findings[0].record.packages;
    assert.equal(wantedPackages.length, 4); assert.equal(new Set(wantedPackages.map(pkg => pkg.occurrenceId)).size, 4);
    assert.ok(findings[0].record.parseWarnings.includes('malformed affected package at 4'));
    assert.ok(findings[0].record.parseWarnings.includes('missing affected package name at 5'));
    const canonicalPrimary = JSON.parse(await fs.readFile(first.records[0].jsonPath, 'utf8'));
    saved = await saveDecision(first.recordIds[0]);
    assert.deepEqual(saved.stored.record.packages, wantedPackages);
    assert.deepEqual(saved.stored.record.parseWarnings, findings[0].record.parseWarnings,
      'saved package evidence keeps the source partial-coverage diagnostics');
    const reordered = await ingest('aws_inspector', [{ ...primary, packageVulnerabilityDetails: {
      ...primary.packageVulnerabilityDetails, vulnerablePackages: [
        ...primary.packageVulnerabilityDetails.vulnerablePackages.slice(0, 4).reverse(),
        ...primary.packageVulnerabilityDetails.vulnerablePackages.slice(4)
      ]
    } }]);
    assert.deepEqual(reordered.recordIds, [first.recordIds[0]]);
    const after = JSON.parse(await fs.readFile(reordered.records[0].jsonPath, 'utf8'));
    assert.deepEqual(after, canonicalPrimary, 'equivalent repeated/reordered imports preserve the actual canonical selector and all occurrence associations');
    for (const pkg of wantedPackages) {
      const text = await fs.readFile(saved.mdPath, 'utf8');
      assert.ok(text.includes(pkg.occurrenceId)); assert.ok(text.includes(pkg.manifestPath));
      assert.ok(text.includes(pkg.installedVersion)); assert.ok(text.includes(pkg.fixedVersion));
    }
  } else {
    const first = await ingest('generic', [
      { source: 'generic', recordType: 'finding', stableKey: 'legacy-singleton', createdAt: '2024-01-01T00:00:00.000Z',
        vuln: { vulnId: 'CVE-LEGACY', title: 'Legacy admitted evidence' },
        package: { name: 'legacyunique', installedVersion: '4', fixedVersion: '4.1', manifestPath: '/legacy/manifest.json', importName: 'legacyimportunique' } },
      { source: 'generic', recordType: 'finding', stableKey: 'explicit-empty', createdAt: '2024-01-01T00:00:00.000Z',
        vuln: { vulnId: 'CVE-EMPTY', title: 'Explicit empty package authority' }, packages: [], importName: 'recordimportunique',
        package: { name: 'ghostunique', installedVersion: '9', manifestPath: '/ghost/manifest.json',
          importName: 'ghostimportunique', module: 'ghostmoduleunique', moduleName: 'ghostmodulenameunique' } },
      { source: 'generic', recordType: 'finding', stableKey: 'canonical-import-aliases', createdAt: '2024-01-01T00:00:00.000Z',
        vuln: { vulnId: 'CVE-CANONICAL', title: 'Canonical package import evidence' },
        packages: [{ name: 'canonicalunique', installedVersion: '5', importName: 'canonicalimportunique',
          module: 'canonicalmoduleunique', moduleName: 'canonicalmodulenameunique' }],
        package: { name: 'excludedcompatunique', importName: 'excludedcompatimportunique' } }
    ]);
    findings = await Promise.all(first.recordIds.map(snapshot));
    assert.equal(Object.hasOwn(findings[0].record, 'packages'), false);
    assert.deepEqual(findings[1].record.packages, []);
    saved = await saveDecision(first.recordIds[0]);
    assert.deepEqual(saved.stored.record.packages, [findings[0].record.package]);
    const empty = await saveDecision(first.recordIds[1]);
    assert.deepEqual(empty.stored.record.packages, []);
    assert.equal((await fs.readFile(empty.mdPath, 'utf8')).includes('ghostunique'), false,
      'new decision rendering cannot index an excluded compatibility representative');
  }

  // One fresh real records publication per case. Neither the artifact writer,
  // postings, metadata loader, retrieval filters nor context consumer is mocked.
  await buildIndex(repo, { mode: 'records', stage: 'stage2', threads: 1, incremental: false,
    sqlite: false, 'stub-embeddings': true, 'scm-provider': 'none' });
  const indexDir = getIndexDir(repo, 'records', loadUserConfig(repo));
  const indexed = await Array.fromAsync(loadJsonArrayArtifactRows(indexDir, 'chunk_meta', { strict: true }));
  const indexedIds = indexed.map(row => row.docmeta.record.recordId);
  assert.equal(indexedIds.length, selected === 'multi-package' ? 3 : 5);
  assert.equal(new Set(indexedIds).size, indexedIds.length, 'repeat import cannot duplicate findings or orphan their decision');
  for (const item of findings) assert.ok(indexedIds.includes(item.record.recordId));
  assert.ok(indexedIds.includes(saved.recordId));
  if (selected === 'multi-package') {
    for (const row of indexed.filter(row => [findings[0].record.recordId, saved.recordId].includes(row.docmeta.record.recordId))) {
      assert.deepEqual(row.docmeta.record.packageName, ['alphaunique', 'zetaunique']);
    }
  }
  const primaryPack = await context(findings[0].record.recordId);
  assert.ok(primaryPack.history.some(record => record.recordId === saved.recordId));
  if (selected === 'multi-package') {
    for (const name of ['alphaunique', 'zetaunique']) {
      const ids = await filter(name, name);
      assert.ok(ids.includes(findings[0].record.recordId)); assert.ok(ids.includes(saved.recordId));
      assert.ok(primaryPack.repoEvidence.queries.some(query => query.query === name));
    }
    assert.deepEqual(primaryPack.finding.packages, wantedPackages);
    assert.deepEqual(primaryPack.history.find(record => record.recordId === saved.recordId).packages, wantedPackages);
    assert.deepEqual(primaryPack.history.find(record => record.recordId === saved.recordId).parseWarnings,
      findings[0].record.parseWarnings);
    const relatedPack = await context(related.record.recordId);
    assert.deepEqual(relatedPack.finding.packages, related.record.packages);
    const precedent = relatedPack.historySelection.items.find(item => item.sourceDecisionId === saved.recordId);
    assert.equal(precedent?.relation, 'relatedPrecedent'); assert.ok(precedent.matchedFields.includes('packageName'));
    assert.equal(precedent.matchedFields.includes('vulnerability'), false, 'nonrepresentative package supplies the independent history match');
    assert.deepEqual(relatedPack.history.find(record => record.recordId === saved.recordId).packages, wantedPackages);
  } else {
    const ids = await filter('legacyunique', 'legacyunique');
    assert.ok(ids.includes(findings[0].record.recordId)); assert.ok(ids.includes(saved.recordId));
    assert.ok(primaryPack.repoEvidence.queries.some(query => query.query === 'legacyunique'));
    assert.ok(primaryPack.repoEvidence.queries.some(query => query.query === 'legacyimportunique'));
    const emptyPack = await context(findings[1].record.recordId);
    assert.deepEqual(emptyPack.finding.packages, []);
    const excluded = new Set(['ghostunique', 'ghostimportunique', 'ghostmoduleunique', 'ghostmodulenameunique', 'manifest.json']);
    assert.equal(emptyPack.repoEvidence.queries.some(query => excluded.has(query.query)), false);
    assert.ok(emptyPack.repoEvidence.queries.some(query => query.query === 'recordimportunique'),
      'independent top-level import evidence remains supported even when package authority is empty');
    assert.equal(emptyPack.historySelection.items.some(item => item.matchedFields.includes('packageName')), false);
    assert.deepEqual(await filter('ghostunique', 'ghostunique'), []);
    for (const row of indexed.filter(row => [findings[1].record.recordId,
      ...emptyPack.history.map(record => record.recordId)].includes(row.docmeta.record.recordId))) {
      assert.equal(Object.hasOwn(row.docmeta.record, 'packageName'), false);
    }
    const canonicalPack = await context(findings[2].record.recordId);
    assert.deepEqual(canonicalPack.finding.packages, findings[2].record.packages);
    assert.deepEqual(await filter('canonicalunique', 'canonicalunique'), [findings[2].record.recordId]);
    assert.deepEqual(await filter('excludedcompatunique', 'excludedcompatunique'), []);
    for (const alias of ['canonicalunique', 'canonicalimportunique', 'canonicalmoduleunique', 'canonicalmodulenameunique']) {
      assert.ok(canonicalPack.repoEvidence.queries.some(query => query.query === alias), 'admitted canonical package aliases remain evidence');
    }
    assert.equal(canonicalPack.repoEvidence.queries.some(query => query.query === 'excludedcompatimportunique'), false);
  }
  assert.deepEqual(await filter('missingunique', 'missingunique'), []);
  console.log(JSON.stringify({ selected, indexDir, recordsDir: getTriageConfig(repo, loadUserConfig(repo)).recordsDir,
    indexedIds, filteredIds, rendererVersion: TRIAGE_RENDERER_VERSION, recordsProducer: SEMANTIC_ANALYSIS_VERSIONS.recordsProducer }));
} finally {
  assert.ok(path.relative(process.cwd(), dir).startsWith('.tmp' + path.sep));
  await fs.rm(dir, { recursive: true, force: true });
}
