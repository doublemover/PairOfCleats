import { throwIfAborted } from '../../../shared/abort.js';
import { WASM_OPS } from './opcodes.js';

/** Structured stack SSA: loop header and exit values exist before back/forward
 * branches. Joining adds edges to stable phis, never iterates producer sets.
 * Only reachable instructions receive value/control edges; syntax is retained.
 */
export const analyzeWasmModule = (module, { signal = null } = {}) => {
  throwIfAborted(signal);
  const nodes = [], edges = [], functions = [], reasons = new Set();
  const budget = () => { if (nodes.length >= 32768 || edges.length >= 131072) throw Object.assign(new Error('WASM flow graph budget.'), { code: 'ERR_WASM_FLOW_BUDGET' }); };
  const node = (kind, data) => { budget(); const id = nodes.length; nodes.push({ id, kind, ...data }); return id; };
  const edge = (kind, from, to, extra = {}) => { budget(); if (from != null && to != null) edges.push({ kind, from, to, ...extra }); };
  const value = (origin, site, type) => node('value', { origin, site, type });
  const imported = module.imports.filter(item => item.kind === 0);
  for (const [index, fn] of [...imported, ...module.functions].entries()) {
    const type = module.types[fn.typeIndex], ref = node('function', { index, typeIndex: fn.typeIndex, import: index < imported.length ? fn : null });
    functions.push({ index, ref, type, params: type.params.map(type => value('parameter', ref, type)),
      results: type.results.map(type => value('return', ref, type)), entry: node('block', { owner: ref, blockKind: 'entry' }),
      exit: node('block', { owner: ref, blockKind: 'exit' }), exception: node('block', { owner: ref, blockKind: 'exception' }) });
  }
  for (const fn of module.functions) {
    throwIfAborted(signal);
    const owner = functions[fn.index], instructions = fn.instructions;
    const refs = instructions.map(item => node('instruction', { ...item, functionIndex: fn.index, owner: owner.ref }));
    const localTypes = [...owner.type.params, ...fn.locals];
    const initialLocals = [...owner.params, ...fn.locals.map(type => value('definition', owner.ref, type))];
    const merge = (site, resultTypes, withLocals = true) => ({
      block: node('block', { owner: owner.ref, blockKind: 'normal' }),
      values: resultTypes.map(type => value('merge', site, type)),
      locals: withLocals ? localTypes.map(type => value('merge', site, type)) : [], incoming: 0
    });
    const exit = { block: owner.exit, values: owner.results, locals: [], incoming: 0 };
    const connect = (state, target, kind = 'controlNext', condition = null) => {
      if (!state) return;
      edge(kind, state.last, target.block, { condition }); target.incoming++;
      const inputs = state.stack.slice(state.stack.length - target.values.length);
      target.values.forEach((ref, index) => edge('flowsTo', inputs[index], ref));
      target.locals.forEach((ref, index) => edge('flowsTo', state.locals[index], ref));
    };
    const signature = item => item.type.typeIndex == null ? item.type : module.types[item.type.typeIndex];
    const clone = state => ({ ...state, stack: [...state.stack], locals: [...state.locals] });
    const run = (start, end, initial, frames) => {
      let state = initial;
      for (let pc = start; pc < end; pc++) {
        throwIfAborted(signal);
        const item = instructions[pc], ref = refs[pc], spec = WASM_OPS.get(item.opcode);
        if (!state) {
          if ([2, 3, 4].includes(item.opcode)) pc = item.endIndex;
          continue;
        }
        edge('controlNext', state.last, ref); state.last = ref;
        const pop = count => { if (count > state.stack.length) throw new Error('Validated WASM stack underflow.'); return count ? state.stack.splice(-count) : []; };
        const use = inputs => inputs.forEach((input, ordinal) => edge('consumes', input, ref, { ordinal }));
        const produce = (inputs, count, origin = 'definition') => {
          use(inputs);
          for (let i = 0; i < count; i++) {
            const output = value(origin, ref, null); edge('defines', ref, output);
            inputs.forEach(input => edge('flowsTo', input, output)); state.stack.push(output);
          }
        };
        const trap = () => edge('exceptional', ref, owner.exception);
        if ([2, 3, 4].includes(item.opcode)) {
          const type = signature(item), condition = item.opcode === 4 ? pop(1)[0] : null;
          if (condition != null) use([condition]);
          const base = state.stack.slice(0, state.stack.length - type.params.length), after = merge(ref, type.results);
          if (item.opcode === 3) {
            const header = merge(ref, type.params); connect(state, header);
            const loopState = { stack: [...base, ...header.values], locals: [...header.locals], last: header.block };
            connect(run(pc + 1, item.endIndex, loopState, [...frames, header]), after);
          } else if (item.opcode === 4) {
            const yes = clone(state), no = clone(state), thenBlock = node('block', { owner: owner.ref, blockKind: 'normal' }), elseBlock = node('block', { owner: owner.ref, blockKind: 'normal' });
            edge('controlTrue', ref, thenBlock, { condition }); edge('controlFalse', ref, elseBlock, { condition });
            yes.last = thenBlock; no.last = elseBlock;
            connect(run(pc + 1, item.elseIndex ?? item.endIndex, yes, [...frames, after]), after);
            connect(item.elseIndex == null ? no : run(item.elseIndex + 1, item.endIndex, no, [...frames, after]), after);
          } else connect(run(pc + 1, item.endIndex, clone(state), [...frames, after]), after);
          state = after.incoming ? { stack: [...base, ...after.values], locals: [...after.locals], last: after.block } : null;
          pc = item.endIndex; continue;
        }
        if (item.opcode === 0) { trap(); state = null; continue; }
        if (item.opcode === 1) continue;
        if (item.opcode === 12 || item.opcode === 13) {
          const condition = item.opcode === 13 ? pop(1)[0] : null;
          if (condition != null) use([condition]);
          connect(state, frames.at(-1 - item.index), condition == null ? 'controlNext' : 'controlTrue', condition);
          if (condition == null) state = null;
          else { const next = node('block', { owner: owner.ref, blockKind: 'normal' }); edge('controlFalse', ref, next, { condition }); state.last = next; }
          continue;
        }
        if (item.opcode === 14) {
          const condition = pop(1)[0]; use([condition]);
          for (const label of new Set([...item.labels, item.fallback])) connect(state, frames.at(-1 - label), 'controlNext', condition);
          state = null; continue;
        }
        if (item.opcode === 15) { connect(state, exit); state = null; continue; }
        if (item.opcode === 16 || item.opcode === 17) {
          const callee = item.opcode === 16 ? functions[item.index] : null, type = callee?.type || module.types[item.typeIndex];
          if (!callee) { edge('consumes', pop(1)[0], ref, { ordinal: 0, slot: 'callee' }); reasons.add('wasm_indirect_call_table_target_unresolved'); }
          const args = pop(type.params.length); use(args); trap();
          if (callee) {
            edge('callTarget', ref, callee.ref, { callSite: ref });
            args.forEach((arg, ordinal) => edge('argumentToParameter', arg, callee.params[ordinal], { callSite: ref, ordinal }));
          }
          for (let ordinal = 0; ordinal < type.results.length; ordinal++) {
            const result = value(callee ? 'return' : 'unknown', ref, type.results[ordinal]);
            edge('defines', ref, result);
            if (callee) edge('returnToResult', callee.results[ordinal], result, { callSite: ref, ordinal });
            else args.forEach(arg => edge('flowsTo', arg, result));
            state.stack.push(result);
          }
          reasons.add('wasm_call_channels_context_insensitive_and_effects_unresolved'); continue;
        }
        if (item.opcode === 26) { use(pop(1)); continue; }
        if (item.opcode === 27) { produce(pop(3), 1, 'merge'); continue; }
        if (item.opcode === 32) { use([state.locals[item.index]]); state.stack.push(state.locals[item.index]); continue; }
        if (item.opcode === 33 || item.opcode === 34) {
          const input = pop(1)[0]; use([input]); state.locals[item.index] = input;
          if (item.opcode === 34) state.stack.push(input); continue;
        }
        if (item.opcode === 35 || item.opcode === 36) {
          produce(item.opcode === 36 ? pop(1) : [], item.opcode === 35 ? 1 : 0, 'unknown');
          reasons.add('wasm_global_state_alias_and_call_effects_unresolved'); continue;
        }
        if (item.opcode >= 0x28 && item.opcode <= 0x40) reasons.add('wasm_memory_contents_alias_growth_and_trap_outcomes_unresolved');
        if (spec.traps) trap();
        produce(pop(spec.inputs), spec.outputs, item.opcode >= 0x28 && item.opcode <= 0x40 ? 'unknown' : 'definition');
      }
      return state;
    };
    connect(run(0, instructions.length - 1, { stack: [], locals: initialLocals, last: owner.entry }, [exit]), exit);
    owner.results.forEach(result => edge('returns', result, owner.ref));
  }
  if (imported.length) reasons.add('wasm_host_import_activation_conversion_and_effects_unobserved');
  if (module.start != null) reasons.add('wasm_start_activation_success_unobserved');
  return { nodes, edges, functions, reasons: [...reasons].sort() };
};
