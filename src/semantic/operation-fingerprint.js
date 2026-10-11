import { semanticHash, canonicalSemanticJson } from '../index/semantic/identity.js';
import { throwIfAborted } from '../shared/abort.js';
/** Bounded ordered syntax fingerprint, for candidates only; never a behavioral proof. */
export const fingerprintSemanticOperation = async ({ store, ref, signal, maxNodes = 256, maxDepth = 32, deadline = Infinity }) => {
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 256 || !Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > 32) throw new TypeError('Invalid operation fingerprint bounds.');
  const hashes = new Map(), active = new Set(), reasons = new Set(), stack = [{ref,depth:0,exit:false}];
  let visited = 0;
  while (stack.length) {
    throwIfAborted(signal);
    if (performance.now() >= deadline) { reasons.add('work_budget'); break; }
    const item = stack.pop(), key = canonicalSemanticJson(item.ref);
    if (item.exit) {
      const children = item.operands.map(row => ({slot:row.slot,ordinal:row.ordinal,flags:row.flags,
        child: row.child ? hashes.get(canonicalSemanticJson(row.child)) || null : 'array-hole'}));
      if (children.some(row => row.child === null)) reasons.add('incomplete_child');
      hashes.set(key,semanticHash('semantic.operation-structure.v2',{node:item.signature,children})); active.delete(key); continue;
    }
    if (hashes.has(key)) continue;
    if (active.has(key)) { reasons.add('cyclic_structure'); continue; }
    if (visited++ >= maxNodes || item.depth >= maxDepth) { reasons.add('structure_budget'); continue; }
    const [node] = await store.getRecords([item.ref],['data'],{signal});
    if (!node) { reasons.add('missing_record'); continue; }
    let signature = {kind:node.kind};
    if (node.kind === 'expression') { signature = {...signature,...node.data}; if (/Identifier|Member|Property|ElementAccess/.test(node.data.astKind)) reasons.add('binding_and_name_constraints_unchecked'); }
    else if (node.kind === 'literal') {
      signature = {...signature,literalKind:node.data.literalKind,scalar:node.data.scalar};

    } else if (node.kind === 'occurrence') { signature = {...signature,roles:node.data.roles,flags:node.data.flags}; reasons.add('binding_and_name_constraints_unchecked'); }
    else { reasons.add('unsupported_structural_kind'); }
    const literalSyntax = node.kind === 'literal' || node.kind === 'expression'
      && (/Literal$|^Template(Head|Middle|Tail|Element)$/.test(node.data.astKind)
        || ['TrueKeyword', 'FalseKeyword', 'NullKeyword', 'JSXText', 'JsxText'].includes(node.data.astKind));
    if (literalSyntax) {
      if (!store.getSourceSpans) reasons.add('literal_source_projection_unavailable');
      else {
        try {
          const [excerpt] = await store.getSourceSpans([item.ref], { signal, maxBytes: 4096 });
          if (excerpt?.coordinateUnit === 'utf16' && typeof excerpt.text === 'string') {
            signature.literalTextHash = semanticHash('semantic.literal-source-text.v1', excerpt.text);
          } else reasons.add('literal_source_projection_unavailable');
        } catch (error) {
          if (error.code === 'ERR_SEMANTIC_OUTPUT_LIMIT') reasons.add('literal_source_projection_budget');
          else if (error.code === 'ENOENT') reasons.add('literal_source_projection_unavailable');
          else throw error;
        }
      }
    }
    const operands=[]; let offset=0,done=false;
    while(!done && operands.length<maxNodes && performance.now()<deadline) {
      const page=await store.getRelatedPage(item.ref,'semantic_operands',{offset,limit:Math.min(128,maxNodes-operands.length),signal});
      operands.push(...page.rows);offset=page.offset;done=page.done;
    }
    if(!done) reasons.add('operand_budget');
    operands.sort((a,b)=>a.slot<b.slot?-1:a.slot>b.slot?1:a.ordinal-b.ordinal);
    active.add(key); stack.push({...item,exit:true,signature,operands});
    for(let i=operands.length-1;i>=0;i--) if(operands[i].child) stack.push({ref:operands[i].child,depth:item.depth+1,exit:false});
  }
  return {projectionVersion:2,hash:hashes.get(canonicalSemanticJson(ref))||null,complete:reasons.size===0,
    reasons:[...reasons].sort(),constraints:['types_unchecked','effects_unchecked','bindings_unchecked'],visited};
};
