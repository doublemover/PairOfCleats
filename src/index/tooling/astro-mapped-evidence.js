import { canonicalSemanticJson, semanticHash } from '../semantic/identity.js';
import { mapAstroGeneratedRange, isAdmittedAstroGeneratedDocument } from './vfs/astro-generated-document.js';
import { throwIfAborted } from '../../shared/abort.js';
import { finalizeSourceLinkedReport } from './source-linked-report.js';

const fail = message => Object.assign(new Error(message), { code: 'ERR_ASTRO_GENERATED_MAPPING' });
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const same = (a, b) => canonicalSemanticJson(a) === canonicalSemanticJson(b);

export const ASTRO_MAPPED_PROVIDER_DECLARATION = Object.freeze({ schemaVersion: 1,
  providerId: 'astro-generated-observations', adapterVersion: '3', execution: 'report',
  languages: [{ id: 'astro', dialect: null }],
  facts: [{ family: 'references', evidence: 'source-qualified' }, { family: 'diagnostics', evidence: 'provider-observation' }],
  consumers: [{ id: 'navigation', families: ['references'], partialPolicy: 'qualified', fallback: 'parser' },
    { id: 'semanticDetail', families: ['references', 'diagnostics'], partialPolicy: 'qualified', fallback: 'parser' }],
  contextRequirements: ['source-snapshot', 'project-variant', 'observed-tool', 'dependency-closure'],
  limits: { maxRequests: 256, maxFacts: 256, maxBytes: 1024 * 1024, wallMs: 1000 }, prerequisites: [] });

/** Project captured service observations through an actual admitted compiler
 * map. This imports no language-service display types and launches no server.
 * The original producer must independently pin the generated document/question. */
export const prepareAstroMappedEvidence = ({ document, observations, producingReceipt, expectedReceiptHash, signal = null }) => {
  throwIfAborted(signal);
  if (!Array.isArray(observations) || observations.length > 256
    || Buffer.byteLength(canonicalSemanticJson(observations)) > 65536) throw fail('Astro observation count/byte budget exhausted.');
  if (!producingReceipt || !digest(expectedReceiptHash)) return { status: 'non-authoritative', reason: 'producing_observation_receipt_unavailable', report: null };
  const receipt = JSON.parse(canonicalSemanticJson(producingReceipt));
  observations = JSON.parse(canonicalSemanticJson(observations));
  if (!isAdmittedAstroGeneratedDocument(document) || receipt.schemaVersion !== 1 || semanticHash('tooling.astro-observation-receipt.v1', receipt) !== expectedReceiptHash
    || receipt.generatedDocumentIdentity !== document.identity
    || receipt.observationsHash !== semanticHash('tooling.astro-observations.v1', observations)
    || !same(receipt.generation, document.generation) || receipt.configHash !== document.configHash
    || receipt.dependencyHash !== document.dependencyHash || !digest(receipt.serviceProfileHash)
    || !['typescript-language-service', 'astro-language-server'].includes(receipt.tool?.family)
    || typeof receipt.tool.version !== 'string' || !receipt.tool.version || receipt.tool.version.length > 256) throw fail('Astro observation/source/config/generation producing receipt mismatch.');
  const source = document.source, references = [], diagnostics = [], seen = new Map();
  const witness = span => ({ path: source.path, sourceUnitId: source.sourceUnitId, sourceHash: source.sourceHash, span });
  for (const observation of observations) {
    throwIfAborted(signal);
    if (!['definition', 'typeDefinition', 'references'].includes(observation.method)
      || typeof observation.name !== 'string' || observation.name.length > 256) throw fail('Unsupported Astro service observation method/name.');
    const origin = mapAstroGeneratedRange(document, observation.from);
    if (origin.quality !== 'exact' || origin.spans.length !== 1) {
      if (diagnostics.length < 32) diagnostics.push({ code: 'generated_origin_not_one_exact_interval', span: null,
        mappingQuality: origin.quality, generatedSpan: observation.from });
      continue;
    }
    const target = observation.targetDocumentIdentity === document.identity && observation.target
      ? mapAstroGeneratedRange(document, observation.target) : { quality: 'external', spans: [] };
    const candidates = target.quality === 'exact' ? target.spans.map(witness) : [];
    const one = candidates.length === 1 ? candidates[0] : null;
    const reference = { family: 'astro' + observation.method[0].toUpperCase() + observation.method.slice(1),
      name: observation.name, span: origin.spans[0], target: one, candidates,
      state: one ? 'resolved' : 'unresolved', reason: one ? null : target.quality !== 'exact'
        ? 'generated_target_' + target.quality : 'generated_target_has_disjoint_intervals',
      mapping: { generatedDocumentIdentity: document.identity, mapHash: document.mapHash,
        originQuality: origin.quality, targetQuality: target.quality }, producerObservations: 1 };
    const key = semanticHash('tooling.framework-source-observation.v1', { family: reference.family,
      source: source.sourceUnitId, hash: source.sourceHash, from: reference.span, target: one, candidates });
    if (seen.has(key)) seen.get(key).producerObservations++;
    else { reference.ownershipKey = key; seen.set(key, reference); references.push(reference); }
  }
  const report = { schemaVersion: 1, kind: 'source-linked-evidence', producerId: 'astro-generated-observations', adapterVersion: '3',
    method: 'astro/generated-service-observations', evidenceKind: 'astro-generated-references', generation: document.generation,
    runtime: { family: receipt.tool.family, version: receipt.tool.version, profileHash: receipt.serviceProfileHash,
      qualification: 'captured-observations-and-application-compiler-unqualified', compilerVersion: document.runtime.version },
    project: { configHash: document.configHash, dependencyHash: document.dependencyHash, producingReceiptHash: expectedReceiptHash },
    results: [{ path: source.path, sourceUnitId: source.sourceUnitId, sourceHash: source.sourceHash,
      state: 'partial', reason: 'framework_service_and_compiler_closure_unqualified', references, diagnostics }],
    generatedDocument: document, observations,
    coverage: { mappedOriginalWitnesses: true, componentContracts: false, frameworkServiceAcquisition: false,
      parserReplacement: false, executableConfiguration: false, completeBindings: false } };
  return { status: 'partial', report: finalizeSourceLinkedReport(report, { maxBytes: ASTRO_MAPPED_PROVIDER_DECLARATION.limits.maxBytes,
    fail, message: 'Astro mapped evidence byte budget exhausted.', check: () => throwIfAborted(signal) }) };
};
