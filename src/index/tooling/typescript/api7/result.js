import { createHash } from 'node:crypto';
import { createAjv } from '../../../../shared/validation/ajv-factory.js';
import { snapshotPlainData } from '../../../../shared/plain-data-snapshot.js';
import { typescriptApi7WorkerResultSchema } from '../../../../contracts/schemas/typescript-api7.js';
import { deserializeTypeIr } from '../type-ir/index.js';
import { api7Failure, api7Identity } from './request.js';
import { TYPESCRIPT_API7_PRODUCER_VERSION, TYPESCRIPT_API7_VERSION } from '../../../../shared/typescript-api7-pins.js';

const validate = createAjv().compile(typescriptApi7WorkerResultSchema);
const sourceHash = text => createHash('sha256').update(text).digest('hex');

/** Closed producer receipt, bound to the original request, compiler pair and
 * one fresh snapshot. Serialized finite-string graphs enter through the same
 * canonical TypeIR decoder used by retained semantic consumers. */
export const captureTypeScriptApi7Result = (input, { request, virtualRoot, toolIdentity }) => {
  const result = snapshotPlainData(input, { maxBytes: 8 * 1024 * 1024, maxDepth: 48, maxNodes: 200000,
    maxItems: 4096, label: 'TypeScript7.1 result', code: 'ERR_TYPESCRIPT_API7', nullPrototype: false, freeze: true });
  if (!validate(result) || result.requestIdentity !== api7Identity(request)
    || result.worldIdentity !== 'ts-api7-world-v1:' + api7Identity({ request, virtualRoot, snapshotId: result.snapshotId,
      toolIdentity, version: TYPESCRIPT_API7_VERSION, producer: TYPESCRIPT_API7_PRODUCER_VERSION })) throw api7Failure('invalid-result-provenance');
  const sources = new Map(request.files.map(source => [source.path, source]));
  const projects = new Map();
  const boundSource = record => {
    const source = sources.get(record.path);
    if (!source || sourceHash(source.text) !== record.sourceHash) throw api7Failure('result-source-mismatch'); return source;
  };
  const declaration = record => {
    const source = boundSource(record);
    if (record.start > record.end || record.end > source.text.length || record.text !== source.text.slice(record.start, record.end)) throw api7Failure('result-declaration-mismatch');
  };
  const type = record => {
    if (record.status !== 'exact-finite-string') return;
    const value = record.finiteString;
    if (value.contextKey !== result.worldIdentity || value.graph.contextKey !== result.worldIdentity
      || value.graph.rootIds.length !== 1 || value.graph.rootIds[0] !== value.rootId) throw api7Failure('mixed-snapshot-type-graph');
    deserializeTypeIr(value.graph, { contextKey: result.worldIdentity, maxArenaNodes: 4096, maxArenaBytes: 4 * 1024 * 1024 });
  };
  const symbol = record => {
    if (!record) return;
    record.declarations.forEach(declaration);
    if (record.aliasTarget?.status === 'resolved') symbol(record.aliasTarget.symbol);
  };
  for (const project of result.projects) {
    if (projects.has(project.id)) throw api7Failure('duplicate-result-project'); projects.set(project.id, project);
    for (const rows of [project.files, project.configFiles]) {
      const seen = new Set();
      for (const record of rows) { boundSource(record); if (seen.has(record.path)) throw api7Failure('duplicate-result-source'); seen.add(record.path); }
    }
    if (project.configFile !== null && !project.configFiles.some(record => record.path === project.configFile)) throw api7Failure('result-config-not-bound');
  }
  const diagnostic = record => {
    if (record.path !== null) {
      const source = boundSource(record);
      const fileOnly = record.start === -1 && record.end === -1;
      if (!fileOnly && (record.start < 0 || record.end < record.start || record.end > source.text.length)) throw api7Failure('result-diagnostic-span');
    } else if (record.sourceHash !== null) throw api7Failure('result-diagnostic-authority');
    record.messageChain.forEach(diagnostic); record.relatedInformation.forEach(diagnostic);
  };
  for (const record of result.diagnostics) {
    if (!projects.has(record.projectId)) throw api7Failure('result-diagnostic-project'); diagnostic(record);
  }
  if (result.answers.length !== request.queries.length) throw api7Failure('result-query-coverage');
  result.answers.forEach((answer, index) => {
    const query = request.queries[index], project = projects.get(answer.projectId);
    if (answer.id !== query.id || answer.path !== query.path || answer.position !== query.position || answer.worldIdentity !== result.worldIdentity
      || !project?.files.some(record => record.path === query.path)
      || request.project.kind === 'configured' && project.configFile !== query.configFile) throw api7Failure('result-query-identity');
    boundSource(answer); symbol(answer.symbol); type(answer.type);
    for (const signature of answer.signatures) {
      if (signature.declaration) declaration(signature.declaration);
      type(signature.returnType);
      for (const parameter of signature.parameters) { symbol(parameter.symbol); type(parameter.type); }
    }
  });
  return result;
};
