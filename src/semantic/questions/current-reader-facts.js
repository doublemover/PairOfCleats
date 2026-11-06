import { canonicalSemanticJson, semanticHash } from '../../index/semantic/identity.js';
import { throwIfAborted } from '../../shared/abort.js';
import { sourceOrderEntry } from '../source-order.js';
import { qualifySemanticCoverage } from '../coverage-qualification.js';

export const questionRefKey = ref => ref.partitionId + ':' + ref.localId;
const same = (left, right) => left && right && questionRefKey(left) === questionRefKey(right);
const integrity = message => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_INTEGRITY' });
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const compareQuestionSources = (a, b) => compare(a.source.path, b.source.path) || a.source.span[0] - b.source.span[0]
  || a.source.span[1] - b.source.span[1] || compare(a.source.sourceHash, b.source.sourceHash)
  || compare(a.ref.partitionId, b.ref.partitionId) || a.ref.localId - b.ref.localId;
const rowHash = row => semanticHash('repository-question.reader-row.v1', row, { maxBytes: 1048576 });
const locator = (owner, member, offset, row) => ({ owner, member, offset, rowHash: rowHash(row) });

/** One request-local facade over existing admitted readers. Retained state is
 * refs, source sort keys and exact reader positions; never native resources.
 */
export const createCurrentQuestionFacts = ({ store, profile, state, signal, diagnose, maxStateBytes, diagnosticMode = false }) => {
  const targets = new Set(state.seed?.targets.map(entry => questionRefKey(entry.ref)) || []);
  const literals = new Set(state.seed?.literals.map(entry => questionRefKey(entry.ref)) || []);
  const record = async ref => {
    throwIfAborted(signal);
    const [value] = await store.getRecords([ref], ['span', 'scope', 'data'], { signal });
    if (!value || !same(value.ref, ref)) throw integrity('Question fact refers to an absent or different record.');
    return value;
  };
  const entity = async (ref, sort, operatorId) => {
    const value = await record(ref);
    const expected = sort === 'Invocation' ? 'expression' : sort === 'Declaration' ? 'declaration' : 'literal';
    if (value.kind !== expected) {
      diagnose(sort === 'Literal' ? 'refuted' : 'unknown', operatorId, sort === 'Literal' ? 'operand-is-not-a-retained-literal' : 'target-is-not-a-source-declaration', ref);
      return null;
    }
    if (!value.span) { diagnose('unknown', operatorId, 'record-source-span-unavailable', ref); return null; }
    const header = await store.getSourceReference(value, { signal });
    if (!header || header.coordinateUnit !== 'utf16') { diagnose('unknown', operatorId, 'source-coordinate-adapter-unavailable', ref); return null; }
    if (!same(header.ref, ref)) throw integrity('Question source header belongs to another record.');
    const source = { sourceUnitId: header.sourceUnitId, sourceHash: header.sourceHash, path: header.path,
      span: [...value.span], coordinateUnit: 'utf16' };
    const result = { ref: { ...ref }, sort, source };
    if (sort === 'Declaration') {
      const nameRef = { partitionId: ref.partitionId, localId: value.data.nameId };
      const names = await store.getRelatedPage(nameRef, 'semantic_lookup', { offset: 0, limit: 1, signal });
      const name = names.rows[0];
      if (!name || !names.done || name.partitionId !== ref.partitionId || name.id !== nameRef.localId) throw integrity('Retained declaration name lookup is absent or ambiguous.');
      result.name = name.value;
    } else if (sort === 'Literal') result.scalar = value.data.scalar;
    else result.invocationKind = value.data.invocationKind;
    if (source.path.length > 4096 || result.name?.length > 4096 || result.scalar?.representation.length > 4096
      || result.scalar && !['string', 'number', 'boolean', 'null', 'bigint'].includes(result.scalar.type)) {
      diagnose('unknown', operatorId, 'retained-value-exceeds-current-question-profile', ref); return null;
    }
    for (const filter of profile.filters) {
      if (filter.args[0] !== (sort === 'Declaration' ? profile.declaration : sort === 'Literal' ? profile.literal : -1)) continue;
      const matches = filter.predicate === 'declaredNameEquals' ? result.name === filter.args[1]
        : result.scalar !== null && result.scalar.type === filter.args[1].type && result.scalar.representation === filter.args[1].representation;
      if (!matches) {
        diagnose(sort === 'Literal' && result.scalar === null ? 'unknown' : 'refuted', filter.operatorId,
          sort === 'Declaration' ? 'retained-name-differs' : result.scalar === null ? 'parser-scalar-unavailable' : 'typed-scalar-differs', ref);
        return null;
      }
    }
    return result;
  };
  const append = (family, value, witness) => {
    const selected = family === 'targets' ? targets : literals, key = questionRefKey(value.ref);
    if (selected.has(key)) return;
    const entry = { ref: value.ref, source: value.source, witness };
    const charge = 512 + 2 * canonicalSemanticJson(entry, { maxBytes: 65536 }).length;
    if (state.seed[family].length === 4096 || state.retainedBytes + charge > maxStateBytes) {
      throw Object.assign(new Error('One Invocation exceeds the bounded candidate-state allowance. Narrow the source question or expand this Invocation through semantic detail.'), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
    }
    state.retainedBytes += charge; state.seed[family].push(entry); selected.add(key);
  };
  const related = async (owner, member, offset) => {
    const page = await store.getRelatedPage(owner, member, { offset, limit: 1, signal });
    if (page.rows.length > 1 || page.offset !== offset + page.rows.length || !page.done && !page.rows.length) throw integrity('Question reader did not preserve its bounded continuation.');
    return page;
  };
  const edge = async (owner, offset) => {
    const page = await related(owner, 'semantic_edges', offset), value = page.rows[0];
    const targetKind = profile.compiled.scan.invocationKind === 'construct' ? 'constructTarget' : 'callTarget';
    if (value && value.kind === targetKind && same(value.from, owner)) {
      if (value.callSite && !same(value.callSite, owner) && !same(value.callSite, state.seed.ref)) throw integrity('Target candidate belongs to a different call site.');
      const target = await entity(value.to, 'Declaration', profile.target.operatorId);
      if (target) append('targets', target, { operatorId: profile.target.operatorId, meaning: 'recorded-target-candidate',
        fact: locator(owner, 'semantic_edges', offset, value), contextKey: value.contextKey, certainty: value.certainty });
    }
    return page;
  };
  const advance = async () => {
    throwIfAborted(signal);
    const seed = state.seed;
    if (seed.phase === 'admit') {
      const value = await record(seed.ref);
      if (value.kind !== 'expression') throw integrity('Source-order operation index refers to a non-expression.');
      if (value.data.invocationKind !== profile.compiled.scan.invocationKind) { seed.phase = 'done'; return; }
      const invocation = await entity(seed.ref, 'Invocation', null);
      if (!invocation) { seed.phase = 'done'; return; }
      const indexed = sourceOrderEntry(value, seed.ref, invocation.source.path, invocation.source.sourceHash);
      if (invocation.source.path !== state.path || indexed.value !== state.after.value) throw integrity('Source-order projection differs from its retained operation.');
      seed.source = invocation.source;
      if (state.lastCoverageSourceUnit !== invocation.source.sourceUnitId) {
        const coverage = await store.getCoverage([seed.ref.partitionId], { signal });
        state.qualification = qualifySemanticCoverage(state.qualification, coverage);
        state.lastCoverageSourceUnit = invocation.source.sourceUnitId;
      }
      seed.phase = 'operands'; return;
    }
    if (seed.phase === 'operands') {
      const offset = seed.operandOffset, page = await related(seed.ref, 'semantic_operands', offset), value = page.rows[0];
      if (value && (!same(value.parent, seed.ref))) throw integrity('Question operand belongs to another Invocation.');
      if (value?.slot === 'argument' && value.ordinal === profile.operand.args[2]) {
        seed.sawOperand = true;
        if (!value.child || value.flags.some(flag => ['spread', 'rest', 'hole'].includes(flag))) diagnose('unknown', profile.operand.operatorId, 'operand-unavailable-or-unqualified', seed.ref);
        else {
          const child = await entity(value.child, 'Literal', profile.operand.operatorId);
          if (child) append('literals', child, { operatorId: profile.operand.operatorId, meaning: 'syntactic-zero-based-argument',
            fact: locator(seed.ref, 'semantic_operands', offset, value) });
        }
      }
      seed.operandOffset = page.offset;
      if (page.done) {
        if (!seed.sawOperand) diagnose('refuted', profile.operand.operatorId, 'operand-absent-from-retained-facts', seed.ref);
        seed.phase = diagnosticMode || seed.literals.length ? 'direct-targets' : 'done';
      }
      return;
    }
    if (seed.phase === 'direct-targets') {
      const page = await edge(seed.ref, seed.edgeOffset); seed.edgeOffset = page.offset;
      if (page.done) { seed.phase = 'occurrences'; seed.edgeOffset = 0; }
      return;
    }
    if (seed.phase === 'occurrences') {
      const page = await related(seed.ref, 'semantic_records', seed.occurrenceOffset), value = page.rows[0];
      seed.occurrenceOffset = page.offset;
      if (value && (value.kind !== 'occurrence' || !same(value.data.expression, seed.ref))) throw integrity('Associated occurrence belongs to another Invocation.');
      const role = profile.compiled.scan.invocationKind === 'construct' ? 'construct' : 'call';
      if (value?.data.roles.includes(role)) { seed.occurrence = value.ref; seed.occurrenceDone = page.done; seed.edgeOffset = 0; seed.phase = 'occurrence-targets'; }
      else if (page.done) seed.phase = 'sort';
      return;
    }
    if (seed.phase === 'occurrence-targets') {
      const occurrence = await record(seed.occurrence);
      const role = profile.compiled.scan.invocationKind === 'construct' ? 'construct' : 'call';
      if (occurrence.kind !== 'occurrence' || !same(occurrence.data.expression, seed.ref) || !occurrence.data.roles.includes(role)) throw integrity('Retained compiler occurrence no longer qualifies this call.');
      const page = await edge(seed.occurrence, seed.edgeOffset); seed.edgeOffset = page.offset;
      if (page.done) { seed.phase = seed.occurrenceDone ? 'sort' : 'occurrences'; seed.occurrence = null; seed.edgeOffset = 0; }
      return;
    }
    if (seed.phase === 'sort') {
      seed.targets.sort(compareQuestionSources); seed.literals.sort(compareQuestionSources);
      if (!seed.targets.length) diagnose('refuted', profile.target.operatorId, 'no-candidate-in-retained-facts', seed.ref);
      seed.phase = seed.targets.length && seed.literals.length ? 'emit' : 'done';
    }
  };
  const verifyFact = async witness => {
    const fact = witness.fact, page = await related(fact.owner, fact.member, fact.offset), value = page.rows[0];
    if (!value || rowHash(value) !== fact.rowHash) throw integrity('Selected question witness changed under its retained generation.');
    if (fact.member === 'semantic_edges' && !same(fact.owner, state.seed.ref)) {
      const occurrence = await record(fact.owner);
      const role = profile.compiled.scan.invocationKind === 'construct' ? 'construct' : 'call';
      if (occurrence.kind !== 'occurrence' || !same(occurrence.data.expression, state.seed.ref) || !occurrence.data.roles.includes(role)) {
        throw integrity('Selected compiler occurrence belongs to a different call.');
      }
    }
  };
  const row = async () => {
    const seed = state.seed, targetsFirst = profile.compiled.select[1] === profile.declaration;
    const outer = targetsFirst ? seed.targets : seed.literals, inner = targetsFirst ? seed.literals : seed.targets;
    const target = targetsFirst ? outer[seed.outer] : inner[seed.inner], literal = targetsFirst ? inner[seed.inner] : outer[seed.outer];
    await verifyFact(target.witness); await verifyFact(literal.witness);
    const invocation = await entity(seed.ref, 'Invocation', null), declaration = await entity(target.ref, 'Declaration', profile.target.operatorId),
      argument = await entity(literal.ref, 'Literal', profile.operand.operatorId);
    for (const [actual, retained] of [[invocation, seed], [declaration, target], [argument, literal]]) {
      if (!actual || canonicalSemanticJson(actual.source) !== canonicalSemanticJson(retained.source)) throw integrity('Question binding changed under its retained generation.');
    }
    const values = { [profile.scan]: invocation, [profile.declaration]: declaration, [profile.literal]: argument };
    const witnesses = [target.witness, literal.witness, ...profile.filters.map(filter => ({ operatorId: filter.operatorId, ref: values[filter.args[0]].ref }))]
      .sort((a, b) => a.operatorId - b.operatorId);
    const bindings = profile.compiled.select.map((index, ordinal) => ({ variable: profile.compiled.request.select[ordinal], ...values[index] }));
    return { rowId: semanticHash('repository-question.row.v1', { logicalPlanId: profile.logicalPlanId,
      refs: bindings.map(binding => binding.ref) }), bindings, witnesses,
    detailRequest: { repoRoot: store.repoRoot, generation: store.generation, refs: bindings.map(binding => binding.ref), include: ['names', 'operands'] } };
  };
  const consumeRow = () => {
    const seed = state.seed, inner = profile.compiled.select[1] === profile.declaration ? seed.literals : seed.targets;
    if (++seed.inner === inner.length) { seed.inner = 0; seed.outer++; }
    const outer = profile.compiled.select[1] === profile.declaration ? seed.targets : seed.literals;
    if (seed.outer === outer.length) seed.phase = 'done';
    state.emitted++;
  };
  return { advance, row, consumeRow, readEntity: entity, verifyFact };
};
