import path from 'node:path';
import { openPublishedSemanticStore } from '../../src/semantic/published-store.js';
import { resolveIndexDir } from '../../src/retrieval/cli-index.js';
import { readVerifiedContainedFile } from '../../src/shared/contained-file.js';
import { throwIfAborted } from '../../src/shared/abort.js';
import { canonicalSemanticJson } from '../../src/index/semantic/identity.js';

const key = canonicalSemanticJson;
const BINDING_EDGES = ['references', 'callTarget', 'constructTarget'];
const fail = (code, message) => Object.assign(new Error(message), { code });
const sameRef = (left, right) => left && right && left.partitionId === right.partitionId && left.localId === right.localId;
const position = (source, offset) => {
  let low = 0, high = source.lineStarts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (source.lineStarts[mid] <= offset) low = mid; else high = mid - 1;
  }
  return { line: low + 1, col: offset - source.lineStarts[low] + 1 };
};

/** Resolve indexed binding witnesses, never spelling similarity. Source ranges
 * come from the same retained UTF-16 snapshot as those immutable witnesses. */
export const queryQualifiedNavigation = async ({ repoRoot, userConfig, kind, query, filePath,
  sourceHash, sourceVersion = null, line, column, coordinateUnit = 'utf16', includeDeclaration = true,
  generation = null, signal = null, limit = 25 }, {
  openStore = openPublishedSemanticStore, readSource = readVerifiedContainedFile,
  clock = () => performance.now(), maxWorkMs = 250, maxRows = 32768
} = {}) => {
  const result = { ok: true, kind, repoRoot, indexDir: null, query, filePath, virtualPath: null,
    sourceHash, sourceVersion, coordinateUnit, generation: null, status: 'partial',
    binding: { status: 'partial', targetId: null, candidates: [], contexts: [] },
    degraded: [], results: [], coverage: { state: 'partial', examinedRows: 0, retainedReadBytes: 0, omittedResults: 0, continuationSupported: false } };
  const resultLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(200, limit) : 25;
  const hash = typeof sourceHash === 'string' ? sourceHash.replace(/^sha256:/, '') : '';
  const relative = path.relative(repoRoot, path.resolve(repoRoot, filePath || ''));
  if (!['definitions', 'references'].includes(kind) || !/^[a-f0-9]{64}$/i.test(hash)
    || !Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1
    || coordinateUnit !== 'utf16' || typeof includeDeclaration !== 'boolean'
    || (sourceVersion !== null && (typeof sourceVersion !== 'string' || sourceVersion.length > 128))
    || !relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    return { ...result, ok: false, code: 'ERR_NAVIGATION_REQUEST', message: 'Qualified navigation requires a contained source, exact SHA-256 and one-based UTF-16 cursor.' };
  }
  result.sourceHash = hash.toLowerCase(); result.virtualPath = relative.replace(/\\/g, '/');
  const started = clock();
  const budget = () => {
    throwIfAborted(signal);
    if (clock() - started > maxWorkMs || result.coverage.examinedRows > maxRows || result.coverage.retainedReadBytes > 4 * 1024 * 1024) throw fail('ERR_NAVIGATION_BUDGET', 'Navigation work is incomplete.');
  };
  let opened;
  try {
    result.indexDir = await resolveIndexDir(repoRoot, 'code', userConfig);
    opened = await openStore({ indexDir: result.indexDir, repoRoot, generation, requireQueryIndex: true });
    const { store, manifest } = opened;
    result.generation = store.generation;
    const run = async () => {
      const partitions = new Map(manifest.partitions.map(partition => [partition.partitionId, partition]));
      const bySource = new Map(), sources = new Map(), bindings = new Map(), verified = new Map();
      for (const partition of partitions.values()) {
        if (!bySource.has(partition.sourceUnitId)) bySource.set(partition.sourceUnitId, []);
        bySource.get(partition.sourceUnitId).push(partition);
      }
      const rows = async function* (partition, member) {
        for await (const row of store.iterateRows(partition.partitionId, member, { signal })) {
          result.coverage.examinedRows++; result.coverage.retainedReadBytes += Buffer.byteLength(JSON.stringify(row)); budget(); yield row;
        }
      };
      const sourceFor = async partitionId => {
        const partition = partitions.get(partitionId);
        if (!partition) throw fail('ERR_SEMANTIC_INTEGRITY', 'Navigation record has no published partition.');
        if (!sources.has(partition.sourceUnitId)) {
          const owner = bySource.get(partition.sourceUnitId).find(item => item.partitionId.startsWith('sy1:')) || partition;
          let source = null;
          for await (const row of rows(owner, 'semantic_sources')) {
            if (source) throw fail('ERR_SEMANTIC_INTEGRITY', 'Multiple retained navigation sources.');
            source = row;
          }
          if (!source || source.sourceUnitId !== partition.sourceUnitId) throw fail('ERR_SEMANTIC_INTEGRITY', 'Missing retained navigation source.');
          sources.set(partition.sourceUnitId, source);
        }
        return sources.get(partition.sourceUnitId);
      };
      const liveSource = async source => {
        if (source.encoding !== 'utf8' || source.coordinateUnit !== 'utf16' || source.mapping) {
          result.degraded.push('source_mapping_requires_explicit_adapter'); return false;
        }
        if (!verified.has(source.sourceUnitId)) verified.set(source.sourceUnitId, (async () => {
          await store.verifySource(source, { signal }); budget();
          try {
            await readSource(repoRoot, path.resolve(repoRoot, source.path), { expectedHash: source.byteHash,
              expectedBytes: source.byteLength, hashAlgorithm: 'sha256', maxBytes: 8 * 1024 * 1024, signal });
            budget(); return true;
          } catch (error) {
            if (['ENOENT', 'ENOTDIR', 'ERR_FILE_INTEGRITY', 'ERR_FILE_TOO_LARGE', 'ERR_FILE_CHANGED'].includes(error.code)) {
              result.degraded.push('stale_or_unavailable_target_source'); return false;
            }
            throw error;
          }
        })());
        return verified.get(source.sourceUnitId);
      };
      let source = null, syntax = null;
      for (const partition of partitions.values()) {
        if (!partition.partitionId.startsWith('sy1:')) continue;
        const candidate = await sourceFor(partition.partitionId);
        if (candidate.path !== result.virtualPath) continue;
        if (candidate.byteHash.toLowerCase() !== result.sourceHash) continue;
        if (source) throw fail('ERR_SEMANTIC_INTEGRITY', 'Source has multiple syntax owners in one generation.');
        source = candidate; syntax = partition;
      }
      if (!source) { result.status = 'stale-source'; result.degraded.push('source_hash_not_in_generation'); return result; }
      if (!await liveSource(source)) { result.status = source.mapping ? 'partial' : 'stale-source'; return result; }
      if (line > source.lineStarts.length) throw fail('ERR_NAVIGATION_REQUEST', 'Cursor line exceeds retained source.');
      const offset = source.lineStarts[line - 1] + column - 1;
      const lineEnd = source.lineStarts[line] ?? source.textLength;
      if (offset > source.textLength || offset >= lineEnd) throw fail('ERR_NAVIGATION_REQUEST', 'Cursor column exceeds retained source line.');
      let occurrence = null;
      for await (const row of rows(syntax, 'semantic_records')) {
        if (row.kind !== 'occurrence' || !row.span || row.span[0] > offset || row.span[1] <= offset) continue;
        if (!occurrence || row.span[1] - row.span[0] < occurrence.span[1] - occurrence.span[0]) occurrence = row;
      }
      if (!occurrence) { result.status = 'unresolved'; result.binding.status = 'unresolved'; result.degraded.push('no_recorded_occurrence_at_cursor'); return result; }
      const occurrenceRef = { partitionId: syntax.partitionId, localId: occurrence.id };
      const bindingRowsFor = async ref => {
        const descriptor = partitions.get(ref.partitionId);
        if (!descriptor) throw fail('ERR_SEMANTIC_INTEGRITY', 'Occurrence partition is unavailable.');
        if (!bindings.has(descriptor.sourceUnitId)) {
          const selected = [];
          for (const partition of bySource.get(descriptor.sourceUnitId)) {
            if (!partition.partitionId.startsWith('sa1:')) continue;
            for await (const row of rows(partition, 'semantic_records')) if (row.kind === 'binding') selected.push({ ...row, ref: { partitionId: partition.partitionId, localId: row.id } });
          }
          bindings.set(descriptor.sourceUnitId, selected);
        }
        return bindings.get(descriptor.sourceUnitId).filter(row => sameRef(row.data.occurrence, ref));
      };
      let witnesses = await bindingRowsFor(occurrenceRef);
      if (!witnesses.length && occurrence.data.expression) witnesses = await bindingRowsFor(occurrence.data.expression);
      const neighbors = async (ref, direction, kinds) => {
        const edges = []; let offset = 0, done = false;
        while (!done) {
          budget();
          const page = await store.getNeighbors(ref, direction, kinds, { offset, limit: 128, signal });
          result.coverage.examinedRows += page.offset - offset;
          result.coverage.retainedReadBytes += Buffer.byteLength(JSON.stringify(page.edges)); budget();
          edges.push(...page.edges); done = page.done;
          if (!done && page.offset <= offset) throw fail('ERR_SEMANTIC_INTEGRITY', 'Navigation edge cursor made no progress.');
          offset = page.offset;
        }
        return edges;
      };
      const candidates = new Map();
      let exactBinding = true;
      for (const witness of witnesses) {
        for (const edge of await neighbors(witness.ref, 'downstream', ['bindingCandidate'])) {
          candidates.set(key(edge.to), edge.to);
          if (edge.certainty !== 'exact-static') exactBinding = false;
        }
      }
      result.binding.contexts = [...new Set(witnesses.map(row => row.data.contextKey))].slice(0, 16);
      const targetRows = new Map();
      const describe = async ref => {
        const [row] = await store.getRecords([ref], ['span', 'data', 'scope'], { signal }); budget();
        if (!row) throw fail('ERR_SEMANTIC_INTEGRITY', 'Binding target record is unavailable.');
        targetRows.set(key(ref), row);
        if (row.kind === 'externalDeclaration') return { targetId: key(ref), ref, status: 'external',
          sourceHash: row.data.sourceHash, coordinateUnit: row.data.sourceRange?.coordinateUnit || null };
        const owner = await sourceFor(ref.partitionId);
        return { targetId: key(ref), ref, status: 'declared', file: owner.path, sourceHash: owner.byteHash,
          coordinateUnit: owner.coordinateUnit, span: row.span };
      };
      for (const ref of candidates.values()) {
        if (result.binding.candidates.length >= 25) { result.degraded.push('binding_candidate_display_limit'); break; }
        result.binding.candidates.push(await describe(ref));
      }
      if (candidates.size > 1 || witnesses.some(row => row.data.status === 'ambiguous')) {
        result.status = 'ambiguous'; result.binding.status = 'ambiguous'; return result;
      }
      if (!candidates.size) { result.status = 'unresolved'; result.binding.status = 'unresolved'; return result; }
      if (!exactBinding || !witnesses.length || witnesses.some(row => row.data.status !== 'resolved' || row.data.candidateCount !== 1)) {
        result.degraded.push('binding_is_not_exactly_resolved'); return result;
      }
      const target = candidates.values().next().value;
      const targetRow = targetRows.get(key(target));
      result.binding.targetId = key(target);
      if (targetRow.kind === 'externalDeclaration') { result.status = 'external'; result.binding.status = 'external'; return result; }
      const location = async (ref, row, role) => {
        const owner = await sourceFor(ref.partitionId);
        if (!row.span || row.span[0] > row.span[1] || row.span[1] > owner.textLength || !await liveSource(owner)) return null;
        const start = position(owner, row.span[0]), end = position(owner, row.span[1]);
        return { name: query, qualifiedName: query, kind: row.kind, file: owner.path, virtualPath: owner.path,
          ref, targetId: key(target), sourceHash: owner.byteHash, coordinateUnit: 'utf16', role,
          startLine: start.line, startCol: start.col, endLine: end.line, endCol: end.col, score: 0 };
      };
      const admitted = new Set();
      const admit = row => {
        if (!row) return;
        const identity = key(row.ref); if (admitted.has(identity)) return; admitted.add(identity);
        if (result.results.length < resultLimit) result.results.push(row); else result.coverage.omittedResults++;
      };
      if (kind === 'definitions' || includeDeclaration) admit(await location(target, targetRow, 'definition'));
      if (kind === 'references') {
        for (const edge of await neighbors(target, 'upstream', BINDING_EDGES)) {
          if (edge.certainty !== 'exact-static') { result.degraded.push('nonexact_reference_candidate'); continue; }
          const evidence = await bindingRowsFor(edge.from);
          if (!evidence.length || evidence.some(row => row.data.status !== 'resolved' || row.data.candidateCount !== 1)) {
            result.degraded.push('reference_binding_incomplete'); continue;
          }
          let matchingTarget = true;
          for (const witness of evidence) {
            const targets = await neighbors(witness.ref, 'downstream', ['bindingCandidate']);
            if (targets.length !== 1 || !sameRef(targets[0].to, target)) matchingTarget = false;
          }
          if (!matchingTarget) { result.degraded.push('reference_binding_target_conflict'); continue; }
          const [row] = await store.getRecords([edge.from], ['span', 'data', 'scope'], { signal }); budget();
          if (!row) throw fail('ERR_SEMANTIC_INTEGRITY', 'Reference source record is unavailable.');
          if (!includeDeclaration && row.kind === 'occurrence' && row.data.roles.includes('definition')) continue;
          admit(await location(edge.from, row, 'reference'));
        }
      }
      const coverage = await store.getCoverage([syntax.partitionId], { signal }); budget();
      const complete = coverage.some(row => row.phase === 'bindings')
        && coverage.filter(row => row.phase === 'bindings').every(row => row.state === 'complete');
      if (kind === 'references' && !complete) result.degraded.push('reference_population_coverage_incomplete');
      result.status = result.degraded.length || result.coverage.omittedResults ? 'partial' : 'resolved';
      result.binding.status = 'resolved'; result.coverage.state = result.status === 'resolved' ? 'complete' : 'partial';
      return result;
    };
    return typeof store.withReadScope === 'function' ? await store.withReadScope(run) : await run();
  } catch (error) {
    if (error.code === 'ERR_NAVIGATION_BUDGET' || ['ERR_SEMANTIC_UNAVAILABLE', 'ERR_SEMANTIC_QUERY_INDEX_UNAVAILABLE'].includes(error.code)) {
      result.degraded.push(error.code); result.status = 'partial'; return result;
    }
    if (error.code === 'ERR_NAVIGATION_REQUEST') return { ...result, ok: false, code: error.code, message: error.message };
    throw error;
  } finally {
    result.degraded = [...new Set(result.degraded)];
    await opened?.close?.();
  }
};
