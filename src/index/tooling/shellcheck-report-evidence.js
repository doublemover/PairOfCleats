import { createHash } from 'node:crypto';
import { canonicalSemanticJson, semanticHash } from '../semantic/identity.js';
import { throwIfAborted } from '../../shared/abort.js';
import { finalizeSourceLinkedReport } from './source-linked-report.js';

const fail = message => Object.assign(new Error(message), { code: 'ERR_SHELLCHECK_REPORT_EVIDENCE' });
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const same = (left, right) => canonicalSemanticJson(left) === canonicalSemanticJson(right);
const safePath = value => typeof value === 'string' && value.length > 0 && value.length <= 4096
  && !/[\\:\x00-\x1f]/u.test(value) && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..');

export const SHELLCHECK_REPORT_PROVIDER_DECLARATION = Object.freeze({ schemaVersion: 1,
  providerId: 'shellcheck-json1-import', adapterVersion: '2', execution: 'report', languages: [{ id: 'shell', dialect: 'bash-posix' }],
  facts: [{ family: 'diagnostics', evidence: 'source-qualified' }],
  consumers: [{ id: 'semanticDetail', families: ['diagnostics'], partialPolicy: 'qualified', fallback: 'parser' }],
  contextRequirements: ['source-snapshot', 'observed-tool', 'dependency-closure'],
  limits: { maxRequests: 1, maxFacts: 4096, maxBytes: 1024 * 1024, wallMs: 1000 }, prerequisites: [] });

const positions = (text, check) => {
  const lines = [{ offsets: [0] }];
  let offset = 0;
  for (const character of text) {
    check(); offset += character.length;
    if (character === '\n') lines.push({ offsets: [offset] });
    else lines.at(-1).offsets.push(offset);
  }
  return comment => {
    if (![comment.line, comment.column, comment.endLine, comment.endColumn].every(value => Number.isSafeInteger(value) && value >= 1)) return null;
    const start = lines[comment.line - 1]?.offsets[comment.column - 1], end = lines[comment.endLine - 1]?.offsets[comment.endColumn - 1];
    return start === undefined || end === undefined || end < start ? null : [start, end];
  };
};

/** Offline complete JSON1 only. Original producing source/profile policy is
 * required; no ShellCheck process, external source read or fix application runs.
 * JSON1's non-virtual columns count Unicode characters with one-column tabs. */
export const prepareShellcheckReportEvidence = ({ bytes, producingReceipt, expectedReceiptHash, generation, documents,
  maxReportBytes = 256 * 1024, maxSourceBytes = 500 * 1024, maxComments = 4096, maxMs = 1000, signal = null }) => {
  if (!(bytes instanceof Uint8Array) || !(documents instanceof Map) || !documents.size || documents.size > 20
    || !Number.isSafeInteger(maxReportBytes) || maxReportBytes < 1 || maxReportBytes > 256 * 1024 || bytes.byteLength > maxReportBytes
    || !Number.isSafeInteger(maxSourceBytes) || maxSourceBytes < 1 || maxSourceBytes > 500 * 1024
    || !Number.isSafeInteger(maxComments) || maxComments < 1 || maxComments > 4096
    || !Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > 1000) throw fail('Invalid bounded ShellCheck report inputs.');
  const started = performance.now();
  const check = () => { throwIfAborted(signal); if (performance.now() - started >= maxMs) throw fail('ShellCheck import time budget exhausted.'); };
  check(); bytes = Buffer.from(bytes);
  const artifactHash = createHash('sha256').update(bytes).digest('hex');
  if (!producingReceipt || !digest(expectedReceiptHash)) return { status: 'non-authoritative', reason: 'producing_source_receipt_unavailable', artifactHash, report: null };
  producingReceipt = JSON.parse(canonicalSemanticJson(producingReceipt));
  if (producingReceipt.schemaVersion !== 1 || semanticHash('tooling.shellcheck-producing-receipt.v1', producingReceipt) !== expectedReceiptHash
    || producingReceipt.artifactHash !== artifactHash || !same(producingReceipt.generation, generation)
    || !digest(producingReceipt.profileHash) || !digest(producingReceipt.configHash) || !digest(producingReceipt.dependencyHash)
    || producingReceipt.format !== 'json1' || producingReceipt.coordinateEncoding !== 'unicode-codepoints-onebased-tab1'
    || producingReceipt.complete !== true || ![0, 1].includes(producingReceipt.exitCode)
    || producingReceipt.rcFiles !== 'disabled' || producingReceipt.externalSources !== false
    || typeof producingReceipt.toolVersion !== 'string' || !producingReceipt.toolVersion || producingReceipt.toolVersion.length > 256
    || !Array.isArray(producingReceipt.sources) || producingReceipt.sources.length !== documents.size) throw fail('ShellCheck artifact/source/profile/policy/generation receipt mismatch.');
  let input;
  try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw fail('ShellCheck report must be complete UTF-8 JSON1.'); }
  if (!input || Array.isArray(input) || !Array.isArray(input.comments) || Object.keys(input).length !== 1
    || input.comments.length > maxComments || (producingReceipt.exitCode === 1 && !input.comments.length)) throw fail('Malformed or incomplete ShellCheck JSON1 framing.');
  const sources = new Map(), results = new Map(), sourceIds = new Set();
  let sourceBytes = 0;
  for (const receipt of producingReceipt.sources) {
    check();
    const item = documents.get(receipt.sourcePath);
    if (!safePath(receipt.sourcePath) || typeof receipt.outputFile !== 'string' || !receipt.outputFile || receipt.outputFile.length > 4096
      || /[\x00-\x1f]/u.test(receipt.outputFile) || sources.has(receipt.outputFile)
      || !item || item.source.path !== receipt.sourcePath || item.source.sourceUnitId !== receipt.sourceUnitId
      || item.source.byteHash !== receipt.byteHash || sourceIds.has(receipt.sourceUnitId)
      || item.syntax?.partitionId !== receipt.syntaxPartitionId || item.syntax?.canonicalHash !== receipt.syntaxHash
      || !['bash', 'sh', 'dash'].includes(receipt.dialect) || typeof item.text !== 'string'
      || createHash('sha256').update(item.text).digest('hex') !== receipt.byteHash
      || !same(item.facts.storage.generation, generation)) throw fail('ShellCheck diagnostic source differs from its producing parser snapshot.');
    if (item.source.mapping && item.source.mapping.quality !== 'exact') throw fail('ShellCheck source mapping is not exact.');
    sourceBytes += Buffer.byteLength(item.text);
    if (sourceBytes > maxSourceBytes) throw fail('ShellCheck source byte budget exhausted.');
    sources.set(receipt.outputFile, { receipt, item, range: positions(item.text, check) }); sourceIds.add(receipt.sourceUnitId);
    results.set(receipt.outputFile, { path: item.source.path, sourceUnitId: item.source.sourceUnitId, sourceHash: item.source.byteHash,
      dialect: receipt.dialect, state: 'partial', reason: 'diagnostic_observation_only', references: [], diagnostics: [], omittedDiagnostics: 0 });
  }
  let unmapped = 0;
  for (const comment of input.comments) {
    check();
    const source = sources.get(comment?.file), result = results.get(comment?.file);
    if (!source || !comment || !Number.isSafeInteger(comment.code) || comment.code < 0 || comment.code > 99999
      || !['error', 'warning', 'info', 'style'].includes(comment.level) || typeof comment.message !== 'string'
      || comment.message.length > 4096) throw fail('ShellCheck comment has no admitted original source or diagnostic identity.');
    const span = source.range(comment);
    if (!span) unmapped++;
    if (result.diagnostics.length >= 32) { result.omittedDiagnostics++; continue; }
    result.diagnostics.push({ code: `SC${comment.code}`, severity: comment.level, message: comment.message, span,
      mapping: span ? 'exact' : 'unmapped', reason: span ? null : 'invalid_original_source_range',
      fix: comment.fix || null, fixApplicationAllowed: false });
  }
  const report = { schemaVersion: 1, kind: 'source-linked-evidence', producerId: 'shellcheck-json1-import', adapterVersion: '2',
    method: 'shellcheck/json1', evidenceKind: 'shellcheck-diagnostics', generation: JSON.parse(canonicalSemanticJson(generation)),
    runtime: { family: 'shellcheck', version: producingReceipt.toolVersion, profileHash: producingReceipt.profileHash,
      qualification: 'producing-receipt-observation' }, project: { configHash: producingReceipt.configHash, dependencyHash: producingReceipt.dependencyHash },
    producingReceiptHash: expectedReceiptHash, reportArtifact: { hash: artifactHash, bytes: bytes.length, base64: bytes.toString('base64') },
    results: [...results.values()], coverage: { diagnosticsOnly: true, externalSources: false, rcFiles: false,
      sourceExecuted: false, fixesApplied: false }, metrics: { sourceBytes, comments: input.comments.length, unmapped } };
  check();
  return { status: 'partial', reason: 'diagnostic_observation_only', artifactHash,
    report: finalizeSourceLinkedReport(report, { maxBytes: SHELLCHECK_REPORT_PROVIDER_DECLARATION.limits.maxBytes,
      fail, message: 'ShellCheck report output byte budget exhausted.', check }) };
};
