import { proposalEffect } from './proposals.js';
import { createWasmTableTargets } from './tables.js';
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
      exit: node('block', { owner: ref, blockKind: 'exit' }), exception: node('block', { owner: ref, blockKind: 'exception' }), trap: node('block', { owner: ref, blockKind: 'exception' }), thrown: node('block', { owner: ref, blockKind: 'exception' }) });
  }
  for (const fn of functions) { edge('throws', fn.thrown, fn.exception); edge('exceptional', fn.trap, fn.exception); }
  const tags = [...module.imports.filter(item => item.kind === 4), ...module.tags];
  const importedTagCount = module.imports.filter(item => item.kind === 4).length;
  const tagTypes = index => module.types[tags[index].typeIndex].params;
  const storages = {};
  for (const [kind, number] of [['table',1],['memory',2],['global',3]]) {
    const definitions = [...module.imports.filter(item=>item.kind===number).map(item=>item[kind]), ...module[kind==='memory'?'memories':kind+'s']];
    storages[kind] = definitions.map((type,index)=>node('storage',{storageKind:kind,index,type}));
  }
  storages.tag = tags.map((tag,index) => node('storage', {storageKind:'tag', index, type:tag}));
  storages.data = module.data.map((segment,index)=>{
    const source=node('storage',{storageKind:'data-segment',index,type:{mode:segment.mode,offset:segment.offset}});
    if(segment.mode==='active')edge('copies',source,storages.memory[segment.memoryIndex||0]);return source;
  });
  storages.element = module.elements.map((segment, index) => {
    const source = node('storage', { storageKind: 'element-segment', index, type: segment });
    if (segment.mode === 'active') edge('copies', source, storages.table[segment.tableIndex || 0]);
    for (const target of segment.functions || segment.expressions?.filter(expr => expr[0]?.name === 'ref.func').map(expr => expr[0].index) || []) edge('packs', functions[target]?.ref, source);
    return source;
  });
  module.globals.forEach((global,index)=>{
    const source=node('storage',{storageKind:'global-initializer',index,type:global});
    edge('defines',source,storages.global[module.imports.filter(item=>item.kind===3).length+index]);
  });
  const tableTargets = createWasmTableTargets(module), constants = new Map(), functionValues = new Map();
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
    const connect = (state, target, kind = 'controlNext', condition = null, certainty = 'modeled') => {
      if (!state) return;
      edge(kind, state.last, target.block, { condition, certainty }); target.incoming++;
      const inputs = state.stack.slice(state.stack.length - target.values.length);
      target.values.forEach((ref, index) => edge('flowsTo', inputs[index], ref));
      target.locals.forEach((ref, index) => edge('flowsTo', state.locals[index], ref));
    };
    const signature = item => item.type.typeIndex == null ? item.type : module.types[item.type.typeIndex];
    const clone = state => ({ ...state, stack: [...state.stack], locals: [...state.locals] });
    // Catchable throws have a separate channel from traps. Unknown interprocedural
    // tags fan out to ordered candidate handlers; only catch_all closes the residual.
    const deliver = (state, from, handlers, tag = null, payload = [], exception = null) => {
      if (tag != null && tag < importedTagCount) { tag = null; reasons.add('wasm_imported_tag_alias_identity_unobserved'); }
      const seenTags = new Set();
      for (const handler of [...handlers].reverse()) for (const clause of handler.clauses) {
        if (clause.tag != null && (seenTags.has(clause.tag) || tag != null && tag !== clause.tag)) continue;
        if (clause.tag != null) seenTags.add(clause.tag);
        const values = clause.tag == null ? [] : tag === clause.tag ? [...payload] : tagTypes(clause.tag).map(type => {
          const result = value('unknown', from, type); edge('defines', from, result); return result;
        });
        if (clause.withRef) {
          const reference = exception ?? value('unknown', from, 'exnref');
          if (exception == null) edge('defines', from, reference);
          values.push(reference);
        }
        connect({ stack: [...handler.base, ...values], locals: state.locals, last: from }, clause.target, 'exceptional');
        if (tag != null || clause.tag == null) return;
      }
      edge('throws', from, owner.thrown);
      payload.forEach(input => edge('flowsTo', input, owner.thrown));
    };
    const run = (start, end, initial, frames, handlers = []) => {
      let state = initial;
      for (let pc = start; pc < end; pc++) {
        throwIfAborted(signal);
        const item = instructions[pc], ref = refs[pc], spec = item.prefix ? proposalEffect(item,module) : WASM_OPS.get(item.opcode);
        if (!state) {
          if ([2, 3, 4, 6, 0x1f].includes(item.opcode)) pc = item.endIndex;
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
            if (item.name==='i32.const') constants.set(output,item.value);
            if (item.name==='ref.func') functionValues.set(output,item.index);
          }
        };
        const trap = () => edge('exceptional', ref, owner.trap);
        if ([2, 3, 4, 6, 0x1f].includes(item.opcode)) {
          const type = signature(item), condition = item.opcode === 4 ? pop(1)[0] : null;
          if (condition != null) use([condition]);
          const base = state.stack.slice(0, state.stack.length - type.params.length), after = merge(ref, type.results);
          after.handlers = handlers;
          if (item.opcode === 6 || item.opcode === 0x1f) {
            const legacy = item.opcode === 6;
            const catches = legacy ? (item.catchIndices || []).map(index => ({ index, tag: instructions[index].opcode === 7 ? instructions[index].index : null })) : item.catches;
            const clauses = catches.map(clause => ({ ...clause, withRef: !legacy && (clause.kind === 1 || clause.kind === 3),
              target: legacy ? merge(refs[clause.index], clause.tag == null ? [] : tagTypes(clause.tag)) : frames.at(-1 - clause.label) }));
            let innerHandlers = [...handlers, { base, clauses }];
            if (legacy && instructions[item.endIndex].opcode === 24) {
              innerHandlers = frames.at(-1 - instructions[item.endIndex].index)?.handlers || [];
              reasons.add('wasm_legacy_delegate_exception_delivery_modeled');
            }
            const frame = { ...after, handlers: innerHandlers };
            Object.defineProperty(frame, 'incoming', { get: () => after.incoming, set: count => { after.incoming = count; } });
            const bodyEnd = legacy ? item.catchIndices?.[0] ?? item.endIndex : item.endIndex;
            connect(run(pc + 1, bodyEnd, clone(state), [...frames, frame], innerHandlers), after);
            for (let index = 0; legacy && index < clauses.length; index++) {
              const clause = clauses[index];
              if (!clause.target.incoming) continue;
              const caught = { stack: [...base, ...clause.target.values], locals: [...clause.target.locals], last: clause.target.block };
              const catchFrame = { ...after, caught: { tag: clause.tag, payload: clause.target.values, handlers } };
              // Branches still join the common exit; caught metadata follows label depth.
              Object.defineProperty(catchFrame, 'incoming', { get: () => after.incoming, set: count => { after.incoming = count; } });
              connect(run(clause.index + 1, clauses[index + 1]?.index ?? item.endIndex, caught, [...frames, catchFrame], handlers), after);
            }
            reasons.add('wasm_exception_tags_host_delivery_and_rethrows_modeled');
          } else if (item.opcode === 3) {
            const header = merge(ref, type.params); header.handlers = handlers; connect(state, header);
            const loopState = { stack: [...base, ...header.values], locals: [...header.locals], last: header.block };
            connect(run(pc + 1, item.endIndex, loopState, [...frames, header], handlers), after);
          } else if (item.opcode === 4) {
            const yes = clone(state), no = clone(state), thenBlock = node('block', { owner: owner.ref, blockKind: 'normal' }), elseBlock = node('block', { owner: owner.ref, blockKind: 'normal' });
            edge('controlTrue', ref, thenBlock, { condition }); edge('controlFalse', ref, elseBlock, { condition });
            yes.last = thenBlock; no.last = elseBlock;
            connect(run(pc + 1, item.elseIndex ?? item.endIndex, yes, [...frames, after], handlers), after);
            connect(item.elseIndex == null ? no : run(item.elseIndex + 1, item.endIndex, no, [...frames, after], handlers), after);
          } else connect(run(pc + 1, item.endIndex, clone(state), [...frames, after], handlers), after);
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
        if ([8,9,10].includes(item.opcode)) {
          if (item.opcode === 8) edge('reads', storages.tag[item.index], ref);
          const payload = pop(item.opcode === 8 ? tagTypes(item.index).length : item.opcode === 10 ? 1 : 0); use(payload);
          if (item.opcode === 10) trap();
          const caught = item.opcode === 9 ? frames.at(-1 - item.index)?.caught : null;
          deliver(state, ref, caught?.handlers || handlers, item.opcode === 8 ? item.index : caught?.tag ?? null,
            caught?.payload || payload, item.opcode === 10 ? payload[0] : null);
          state = null; continue;
        }
        if ([0xd5, 0xd6].includes(item.opcode) || item.prefix === 0xfb && [24,25].includes(item.subopcode)) {
          const input = pop(1)[0]; use([input]);
          const cast = item.prefix === 0xfb, branchCarriesRef = cast || item.opcode === 0xd6;
          const branch = clone(state); if (branchCarriesRef) branch.stack.push(input);
          connect(branch, frames.at(-1 - item.index), 'controlTrue', input);
          if (cast || item.opcode === 0xd5) state.stack.push(input);
          const next = node('block', { owner: owner.ref, blockKind: 'normal' }); edge('controlFalse', ref, next, { condition: input }); state.last = next;
          reasons.add('wasm_reference_branch_runtime_type_or_nullness_unobserved'); continue;
        }
        if ([16,17,18,19,20,21].includes(item.opcode)) {
          const direct=item.opcode===16||item.opcode===18, byRef=item.opcode===20||item.opcode===21;
          const tail=[18,19,21].includes(item.opcode);
          const type=direct?functions[item.index].type:module.types[byRef?item.index:item.typeIndex];
          let selection={targets:[item.index],exact:true,unknown:false};
          if(!direct) {
            const selector=pop(1)[0]; edge('consumes',selector,ref,{ordinal:0,slot:'callee'});
            selection=byRef ? functionValues.has(selector)?{targets:[functionValues.get(selector)],exact:true,unknown:false}:{targets:[],exact:false,unknown:true}
              : tableTargets(item,constants.get(selector),functions);
            if(selection.unknown)reasons.add('wasm_indirect_call_table_target_unresolved');
          }
          const args=pop(type.params.length); use(args); trap();
          if(selection.unknown) deliver(state, ref, tail ? [] : handlers);
          const targets=selection.targets.map(index=>functions[index]);
          for(const callee of targets) {
            edge('callTarget',ref,callee.ref,{callSite:ref,certainty:selection.exact?'exact-static':'modeled'});
            edge('exceptional',callee.trap,owner.trap,{callSite:ref});
            // Tail calls discard this function's handlers before entering the callee.
            deliver(state, callee.thrown, tail ? [] : handlers);
            args.forEach((arg,ordinal)=>edge('argumentToParameter',arg,callee.params[ordinal],{callSite:ref,ordinal}));
          }
          for(let ordinal=0;ordinal<type.results.length;ordinal++) {
            const result=value(selection.unknown?'unknown':'return',ref,type.results[ordinal]); edge('defines',ref,result);
            for(const callee of targets)edge('returnToResult',callee.results[ordinal],result,{callSite:ref,ordinal});
            if(selection.unknown)args.forEach(arg=>edge('flowsTo',arg,result));
            state.stack.push(result);
          }
          if(selection.unknown||targets.some(target=>target.index<imported.length))for(const storage of [...storages.table, ...storages.memory, ...storages.global]) {
            if(nodes[storage].type?.mutable===0)continue;
            edge('mutates',ref,storage); args.forEach(arg=>edge('writes',arg,storage));
          }
          reasons.add('wasm_call_channels_context_insensitive_and_effects_unresolved');
          if(tail) { connect(state,exit); state=null; }
          continue;
        }
        if (item.opcode === 26) { use(pop(1)); continue; }
        if (item.opcode === 27 || item.opcode === 28) { produce(pop(3), 1, 'merge'); continue; }
        if (item.opcode === 32) { use([state.locals[item.index]]); state.stack.push(state.locals[item.index]); continue; }
        if (item.opcode === 33 || item.opcode === 34) {
          const input = pop(1)[0]; use([input]); state.locals[item.index] = input;
          if (item.opcode === 34) state.stack.push(input); continue;
        }
        const global = item.opcode === 35 || item.opcode === 36;
        const memory = item.name.includes('load') || item.name.includes('store') || item.name.startsWith('memory.') || item.prefix===0xfe;
        const table = item.name.startsWith('table.');
        const gc = item.prefix===0xfb;
        const inputs = global ? item.opcode===36?pop(1):[] : pop(spec.inputs);
        if (spec.traps) trap();
        const count=global?item.opcode===35?1:0:spec.outputs;
        produce(inputs,count,global||memory||table||gc?'heap':'definition');
        const outputs=count?state.stack.slice(-count):[];
        const storage=global?storages.global[item.index]:memory?storages.memory[item.memoryIndex??item.storageIndex??0]:table?storages.table[item.index??item.storageIndex??0]:null;
        const writes=global?item.opcode===36:memory?/store|grow|fill|copy|init|rmw/.test(item.name):table?/set|grow|fill|copy|init/.test(item.name):false;
        if(storage!=null) {
          outputs.forEach(output=>edge('reads',storage,output));
          if(writes) { edge('mutates',ref,storage); inputs.forEach(input=>edge('writes',input,storage)); }
          if(item.name==='table.init')edge('copies',storages.element[item.segmentIndex],storage);
          if(item.name==='memory.init')edge('copies',storages.data[item.segmentIndex],storage);
          if(item.sourceIndex!=null) {
            const source=(memory?storages.memory:storages.table)[item.sourceIndex]; edge('copies',source,storage);
          }
          reasons.add('wasm_storage_order_alias_and_runtime_contents_conservative');
        }
        if(item.name === 'data.drop' || item.name === 'elem.drop') edge('mutates', ref, storages[item.name === 'data.drop' ? 'data' : 'element'][item.storageIndex]);
        if(gc) {
          outputs.forEach(output=>inputs.forEach(input=>edge('reads',input,output)));
          if(/set|fill|copy|init/.test(item.name)) { edge('mutates',ref,inputs[0]); inputs.slice(1).forEach(input=>edge('writes',input,inputs[0])); }
          reasons.add('wasm_gc_field_alias_lifetime_and_traps_conservative');
        }
        if(item.prefix===0xfe)reasons.add('wasm_atomic_order_wait_wakeup_and_external_writes_unobserved');
        if(item.prefix===0xfd&&item.subopcode>=0x100)reasons.add('wasm_relaxed_simd_nondeterminism_unobserved');
        if(item.name==='memory.grow')reasons.add('wasm_memory_growth_success_and_view_epoch_unobserved');

      }
      return state;
    };
    connect(run(0, instructions.length - 1, { stack: [], locals: initialLocals, last: owner.entry }, [exit]), exit);
    owner.results.forEach(result => edge('returns', result, owner.ref));
  }
  if (imported.length) reasons.add('wasm_host_import_activation_conversion_and_effects_unobserved');
  if (module.start != null) reasons.add('wasm_start_activation_success_unobserved');
  return { nodes, edges, functions, storages, reasons: [...reasons].sort() };
};
