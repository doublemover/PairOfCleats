import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prepareShellcheckReportEvidence, SHELLCHECK_REPORT_PROVIDER_DECLARATION } from '../../../src/index/tooling/shellcheck-report-evidence.js';
import { writeSourceLinkedEvidence } from '../../../src/index/tooling/source-linked-evidence.js';
import { readSourceLinkedEvidenceDetail } from '../../../src/semantic/source-linked-evidence-detail.js';
import { assertProviderDeclaration } from '../../../src/index/tooling/provider-declaration.js';
import { createSemanticProviderResultSink } from '../../../src/index/semantic/merge-provider.js';
import { semanticHash } from '../../../src/index/semantic/identity.js';
import { createSourceLinkedEvidenceFixture } from '../../helpers/source-linked-evidence-fixture.js';

const text = '#!/bin/bash\n\techo 🧭 $value\n';
const f = await createSourceLinkedEvidenceFixture([{ filename: 'script.sh', text, language: 'shell' }]);
try {
  assertProviderDeclaration(SHELLCHECK_REPORT_PROVIDER_DECLARATION);
  const comment = { file: '/producer/script.sh', line: 2, column: 9, endLine: 2, endColumn: 15,
    code: 2086, level: 'info', message: 'Double quote to prevent globbing and word splitting.',
    fix: { replacements: [{ line: 2, column: 9, endLine: 2, endColumn: 15, replacement: '"$value"' }] } };
  const prepare = (comments, changes = {}) => {
    const bytes = Buffer.from(JSON.stringify({ comments })), item = f.sources.get('script.sh');
    const producingReceipt = { schemaVersion: 1, artifactHash: createHash('sha256').update(bytes).digest('hex'), generation: f.generation,
      profileHash: 'a'.repeat(64), configHash: 'b'.repeat(64), dependencyHash: 'c'.repeat(64), format: 'json1',
      coordinateEncoding: 'unicode-codepoints-onebased-tab1', complete: true, exitCode: comments.length ? 1 : 0,
      rcFiles: 'disabled', externalSources: false, toolVersion: 'fixture-not-executed',
      sources: [{ outputFile: '/producer/script.sh', sourcePath: 'script.sh', sourceUnitId: item.source.sourceUnitId,
        byteHash: item.source.byteHash, syntaxPartitionId: item.syntax.partitionId, syntaxHash: item.syntax.canonicalHash, dialect: 'bash' }], ...changes };
    return { bytes, producingReceipt, expectedReceiptHash: semanticHash('tooling.shellcheck-producing-receipt.v1', producingReceipt),
      generation: f.generation, documents: f.sources };
  };
  const options = prepare([comment]), prepared = prepareShellcheckReportEvidence(options), report = prepared.report;
  const diagnostic = report.results[0].diagnostics[0];
  assert.equal(diagnostic.code, 'SC2086');
  assert.equal(diagnostic.severity, 'info');
  assert.equal(text.slice(...diagnostic.span), '$value', 'JSON1 code-point/tab1 columns preserve preceding astral Unicode and a tab');
  assert.equal(diagnostic.fixApplicationAllowed, false);
  assert.equal(report.coverage.sourceExecuted, false);
  const bounded = prepareShellcheckReportEvidence(prepare(Array.from({ length: 40 }, () => comment))).report.results[0];
  assert.equal(bounded.diagnostics.length, 32); assert.equal(bounded.omittedDiagnostics, 8);
  const empty = prepareShellcheckReportEvidence(prepare([]));
  assert.equal(empty.report.results[0].state, 'partial', 'zero observed comments never claims complete shell semantics');
  assert.equal(prepareShellcheckReportEvidence({ ...options, producingReceipt: null }).report, null);
  assert.throws(() => prepareShellcheckReportEvidence(prepare([comment], { exitCode: 2 })), { code: 'ERR_SHELLCHECK_REPORT_EVIDENCE' });
  assert.throws(() => prepareShellcheckReportEvidence(prepare([{ ...comment, file: '../unknown.sh' }])), { code: 'ERR_SHELLCHECK_REPORT_EVIDENCE' });
  assert.throws(() => prepareShellcheckReportEvidence({ ...options, generation: { baseBuildId: 'stale', semanticRevision: 0 } }), { code: 'ERR_SHELLCHECK_REPORT_EVIDENCE' });
  const mutable = prepare([comment]); mutable.generation = { ...f.generation };
  mutable.producingReceipt = JSON.parse(JSON.stringify(mutable.producingReceipt));
  const originalGeneration = { ...mutable.generation }, originalBytes = Buffer.from(mutable.bytes);
  let inspected = false;
  const pinned = prepareShellcheckReportEvidence({ ...mutable, signal: { get aborted() {
    if (!inspected) {
      inspected = true; mutable.generation.semanticRevision++; mutable.producingReceipt.toolVersion = 'caller-replaced'; mutable.bytes.fill(0);
    }
    return false;
  } } }).report;
  assert.ok(inspected); assert.deepEqual(pinned.generation, originalGeneration);
  assert.equal(pinned.runtime.version, 'fixture-not-executed');
  assert.deepEqual(Buffer.from(pinned.reportArtifact.base64, 'base64'), originalBytes);
  const written = await writeSourceLinkedEvidence({ report, sources: f.sources, state: f.state, policy: f.policy,
    semanticSink: createSemanticProviderResultSink({ state: f.state, runtime: f.runtime }) });
  const store = f.store([...f.syntaxPartitions, ...written.output.partitions]);
  const detail = await readSourceLinkedEvidenceDetail({ store, ref: { partitionId: written.output.partitions[0].partitionId, localId: 0 } });
  assert.equal(detail.result.diagnostics[0].code, 'SC2086');
  assert.equal(detail.navigationCandidates.length, 0);
  assert.equal(detail.partial, true);
  console.log('ShellCheck JSON1 original source diagnostics through canonical evidence persistence and bounded detail');
} finally { await f.cleanup(); }
