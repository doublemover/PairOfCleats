import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { parseHandlebarsStructure } from '../../shared/handlebars-ast.js';
import { parseMustacheStructure } from '../../shared/mustache-structure.js';
import { canonicalSemanticJson, semanticHash } from '../semantic/identity.js';
import { throwIfAborted } from '../../shared/abort.js';

const require = createRequire(import.meta.url);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const safePath = value => typeof value === 'string' && value && !value.includes('\\') && !value.includes(':')
  && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..');
const fail = message => Object.assign(new Error(message), { code: 'ERR_TEMPLATE_REFERENCE_EVIDENCE' });
const simpleName = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f]/u.test(value);

export const TEMPLATE_REFERENCE_PROVIDER_DECLARATION = Object.freeze({ schemaVersion: 1,
  providerId: 'template-local-registry', adapterVersion: '1', execution: 'trusted-inprocess',
  languages: [{ id: 'handlebars', dialect: null }, { id: 'mustache', dialect: null }],
  facts: [{ family: 'references', evidence: 'source-qualified' }, { family: 'diagnostics', evidence: 'provider-observation' }],
  consumers: [{ id: 'navigation', families: ['references'], partialPolicy: 'qualified', fallback: 'parser' },
    { id: 'semanticDetail', families: ['references', 'diagnostics'], partialPolicy: 'qualified', fallback: 'parser' }],
  contextRequirements: ['source-snapshot', 'project-variant', 'dependency-closure'],
  limits: { maxRequests: 1, maxFacts: 4096, maxBytes: 500 * 1024, wallMs: 1000 }, prerequisites: [] });

/** Static explicit helper/partial registries only. Uses the shared bounded
 * parse-only models; no template compilation, rendering, helper invocation,
 * view/lambda lookup, custom loader or filesystem discovery is performed. */
export const collectTemplateReferenceEvidence = ({ documents, templates, helpers = new Map(), partials = new Map(),
  generation, configHash, dependencyHash, profileHash = null, maxSourceBytes = 500 * 1024,
  maxReferences = 4096, maxDepth = 16, maxMs = 1000, signal = null }) => {
  if (!(documents instanceof Map) || !documents.size || documents.size > 20 || !(helpers instanceof Map) || !(partials instanceof Map)
    || helpers.size + partials.size > 256 || !Array.isArray(templates) || !templates.length || templates.length > 20
    || new Set(templates.map(value => value.path)).size !== templates.length
    || !generation || !digest(configHash) || !digest(dependencyHash) || (profileHash !== null && !digest(profileHash))
    || !Number.isSafeInteger(maxSourceBytes) || maxSourceBytes < 1 || maxSourceBytes > 500 * 1024
    || !Number.isSafeInteger(maxReferences) || maxReferences < 1 || maxReferences > 4096
    || !Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > 64
    || !Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > 1000) throw fail('Invalid static template registry or bounds.');
  const started = performance.now();
  const check = () => { throwIfAborted(signal); if (performance.now() - started >= maxMs) throw fail('Template evidence time budget exhausted.'); };
  check();
  const handlebarsEntry = fileURLToPath(import.meta.resolve('@handlebars/parser'));
  const handlebarsVersion = JSON.parse(fs.readFileSync(path.resolve(path.dirname(handlebarsEntry), '..', '..', 'package.json'), 'utf8')).version;
  const mustacheVersion = require('mustache').version;
  if (handlebarsVersion !== '2.2.4' || mustacheVersion !== '4.2.0') throw fail('Template parser version is not qualified by this adapter profile.');
  const results = new Map(), models = new Map(), templatePaths = new Set(templates.map(value => value.path));
  let sourceBytes = 0, referenceCount = 0, namespace = null;
  for (const [filename, item] of documents) {
    check();
    if (!safePath(filename) || item?.source?.path !== filename || typeof item.text !== 'string'
      || createHash('sha256').update(item.text).digest('hex') !== item.source.byteHash
      || (namespace !== null && item.source.repositoryNamespace !== namespace)) throw fail('Template dependency differs from its immutable source snapshot.');
    namespace = item.source.repositoryNamespace;
    if (item.source.mapping && item.source.mapping.quality !== 'exact') throw fail('Template mapping is not exact.');
    if (item.facts && canonicalSemanticJson(item.facts.storage.generation) !== canonicalSemanticJson(generation)) throw fail('Template dependency belongs to another generation.');
    sourceBytes += Buffer.byteLength(item.text);
    if (sourceBytes > maxSourceBytes) throw fail('Template source byte budget exhausted.');
    results.set(filename, { path: filename, sourceUnitId: item.source.sourceUnitId, sourceHash: item.source.byteHash,
      state: 'partial', reason: 'source_dependency_only', references: [], diagnostics: [] });
  }
  const targetFor = descriptor => {
    if (!descriptor || !safePath(descriptor.path)) throw fail('Registry target escapes its explicitly admitted root.');
    const item = documents.get(descriptor.path);
    if (!item || !Array.isArray(descriptor.span) || descriptor.span.length !== 2
      || !descriptor.span.every(value => Number.isSafeInteger(value) && value >= 0 && value <= item.text.length)
      || descriptor.span[0] > descriptor.span[1]) throw fail('Registry target lacks an admitted exact source span.');
    for (const offset of descriptor.span) if (offset > 0 && offset < item.text.length
      && /[\uD800-\uDBFF]/u.test(item.text[offset - 1]) && /[\uDC00-\uDFFF]/u.test(item.text[offset])) throw fail('Registry target splits an original Unicode character.');
    return { path: descriptor.path, sourceUnitId: item.source.sourceUnitId, sourceHash: item.source.byteHash, span: [...descriptor.span] };
  };
  const registry = entries => [...entries].map(([name, descriptor]) => {
    if (!simpleName(name)) throw fail('Invalid bounded template registry name.');
    return { name, target: targetFor(descriptor) };
  }).sort((left, right) => left.name.localeCompare(right.name));
  const registryInputs = { helpers: registry(helpers), partials: registry(partials) };
  const helperTargets = new Map(registryInputs.helpers.map(value => [value.name, value.target]));
  const partialTargets = new Map(registryInputs.partials.map(value => [value.name, value.target]));
  const append = (filename, family, name, span, target, reason) => {
    check();
    if (++referenceCount > maxReferences) throw fail('Template reference budget exhausted.');
    results.get(filename).references.push({ family, name, span, target, state: target ? 'resolved' : 'unresolved', reason: target ? null : reason });
  };
  for (const template of templates) {
    check();
    const item = documents.get(template.path), result = results.get(template.path);
    if (!item || !['handlebars', 'mustache'].includes(template.dialect)) throw fail('Template requires explicit supported dialect admission.');
    const model = template.dialect === 'handlebars' ? parseHandlebarsStructure(item.text)
      : parseMustacheStructure(item.text, { remainingMs: () => maxMs - (performance.now() - started) });
    check();
    result.dialect = template.dialect;
    if (model.reason) {
      result.reason = 'parser_unavailable'; result.diagnostics.push({ code: 'parser_unavailable', reason: model.reason, span: null }); continue;
    }
    result.reason = 'context_and_runtime_unknown';
    models.set(template.path, model);
    const covered = new Set();
    if (template.dialect === 'handlebars') for (const invocation of model.invocations) {
      const target = invocation.simple && !invocation.localValue ? helperTargets.get(invocation.name) || null : null;
      const span = [invocation.start, invocation.end]; covered.add(span.join(':'));
      append(template.path, target || invocation.explicitCall ? 'helper' : 'contextVariable', invocation.name, span, target,
        invocation.localValue ? 'local_block_parameter' : invocation.explicitCall ? 'helper_registry_unavailable' : 'context_binding_unknown');
    }
    for (const partial of model.partials) {
      let target = null, reason = 'partial_registry_unavailable';
      if (partial.kind === 'dynamic') reason = 'dynamic_partial_unresolved';
      else if (partial.kind === 'inline') reason = 'inline_partial_scope_unmodeled';
      else if (partial.kind === 'internal') reason = 'partial_block_runtime_context';
      else {
        target = partialTargets.get(partial.name) || null;
        if (target && !templatePaths.has(target.path)) { target = null; reason = 'partial_target_not_admitted_template'; }
      }
      append(template.path, 'partial', partial.name, [partial.start, partial.end], target, reason);
    }
    for (const reference of model.referenceEntries) {
      const span = [reference.start, reference.end];
      if (covered.has(span.join(':')) || reference.type === '>') continue;
      if (template.dialect === 'handlebars' && model.partials.some(value => value.start <= span[0] && value.end >= span[1])) continue;
      append(template.path, 'contextVariable', reference.value, span, null,
        reference.type === '#' || reference.type === '^' ? 'section_runtime_context_unknown' : 'context_binding_unknown');
    }
  }
  // Follow only the already parsed static partial graph to report cycles/depth.
  // No loader is called and no recursive template expansion is constructed.
  for (const filename of models.keys()) {
    const pending = [{ path: filename, chain: [], depth: 0 }], visited = new Set();
    while (pending.length) {
      check();
      const current = pending.pop(), key = current.path + ':' + current.depth;
      if (current.chain.includes(current.path)) {
        const result = results.get(filename);
        if (result.diagnostics.length < 32) result.diagnostics.push({ code: 'partial_cycle', path: current.path, span: null });
        continue;
      }
      if (visited.has(key)) continue; visited.add(key);
      if (current.depth >= maxDepth) {
        const result = results.get(filename);
        if (result.diagnostics.length < 32) result.diagnostics.push({ code: 'partial_depth_budget', path: current.path, span: null });
        continue;
      }
      for (const reference of results.get(current.path)?.references || []) if (reference.family === 'partial' && reference.target) {
        pending.push({ path: reference.target.path, chain: [...current.chain, current.path], depth: current.depth + 1 });
        if (pending.length > maxReferences + templates.length) throw fail('Template partial graph traversal budget exhausted.');
      }
    }
  }
  const report = { schemaVersion: 1, kind: 'source-linked-evidence', producerId: 'template-local-registry', adapterVersion: '1',
    method: 'template/local-registry', evidenceKind: 'template-local-references', generation: JSON.parse(canonicalSemanticJson(generation)),
    runtime: { family: 'template-parse-only', version: `handlebars-${handlebarsVersion}+mustache-${mustacheVersion}`,
      profileHash, qualification: 'application-library-unqualified' },
    project: { configHash, dependencyHash, registryHash: semanticHash('tooling.template-local-registry.v1', registryInputs) },
    registryInputs, results: [...results.values()].map(result => ({ ...result,
      references: result.references.sort((left, right) => left.span[0] - right.span[0] || left.family.localeCompare(right.family)) })),
    coverage: { explicitRegistryOnly: true, rendered: false, loaderExecuted: false, runtimeContextBindings: false },
    metrics: { sourceBytes, referenceCount } };
  check();
  return { ...report, identity: semanticHash('tooling.source-linked-evidence.v1', report) };
};
