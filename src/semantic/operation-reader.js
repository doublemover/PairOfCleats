import { assertSemanticOperationIndex } from '../contracts/validators/semantic-operation-index.js';
import { canonicalSemanticJson } from '../index/semantic/identity.js';
import { compareOperationIndexRows } from './operation-index.js';
import { readJsonlRowsAt } from '../shared/artifact-io/offsets.js';
import { throwIfAborted } from '../shared/abort.js';
export const validateOperationSelector = (selector, offset, limit) => {
  if (!selector || Object.keys(selector).sort().join(',') !== 'field,value' || !['astKind','operation','invocationKind'].includes(selector.field)
    || typeof selector.value !== 'string' || !selector.value.length || selector.value.length > 256
    || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 128) throw new TypeError('Invalid operation selector or page allowance.');
};
export const createArtifactOperationReader = ({ index, inventory, generation, validatePiece }) => {
  let checked = false;
  return async (selector, { offset = 0, limit = 128, signal = null } = {}) => {
    validateOperationSelector(selector, offset, limit); throwIfAborted(signal);
    if (!index) throw Object.assign(new Error('Operation index unavailable; rebuild the current generation.'), { code: 'ERR_SEMANTIC_UNAVAILABLE' });
    if (!checked) {
      assertSemanticOperationIndex(index);
      const expected = [...inventory.values()].map(({partitionId, canonicalHash}) => ({partitionId, canonicalHash})).sort((a,b) => a.partitionId < b.partitionId ? -1 : a.partitionId > b.partitionId ? 1 : 0);
      if (canonicalSemanticJson(index.generation) !== canonicalSemanticJson(generation) || canonicalSemanticJson(index.partitionHashes) !== canonicalSemanticJson(expected)) throw new Error('Operation index generation/input mismatch.');
      let previous = null;
      for (const piece of index.pieces) {
        if (compareOperationIndexRows(piece.firstKey,piece.lastKey) > 0 || previous && compareOperationIndexRows(previous,piece.firstKey) >= 0) throw new Error('Invalid operation index ordering.');
        previous = piece.lastKey;
      }
      checked = true;
    }
    const read = async ordinal => {
      throwIfAborted(signal);
      let low = 0, high = index.pieces.length - 1, piece;
      while (low <= high) { const mid = (low+high) >>> 1, candidate=index.pieces[mid];
        if (ordinal < candidate.firstRow) high=mid-1; else if (ordinal >= candidate.firstRow+candidate.count) low=mid+1; else { piece=candidate; break; } }
      if (!piece) throw new Error('Operation index row out of range.');
      const {dataPath,offsetsPath}=await validatePiece(piece,signal);
      const [row]=await readJsonlRowsAt(dataPath,offsetsPath,[ordinal-piece.firstRow],{maxBytes:1048576});
      assertSemanticOperationIndex(row,{rowOnly:true});
      if (compareOperationIndexRows(row,piece.firstKey)<0 || compareOperationIndexRows(row,piece.lastKey)>0) throw new Error('Operation index key mismatch.');
      return row;
    };
    const bound = async upper => {
      let low=0,high=index.rowCount;
      while(low<high) { const mid=Math.floor((low+high)/2),row=await read(mid);
        const comparison=row.field===selector.field ? row.value===selector.value ? 0 : row.value<selector.value ? -1:1 : row.field<selector.field ? -1:1;
        if(comparison<0 || upper && comparison===0) low=mid+1; else high=mid; }
      return low;
    };
    const start=await bound(false),end=await bound(true),refs=[];
    if(offset>end-start) throw new Error('Operation cursor exceeds selected inventory.');
    for(let ordinal=start+offset;ordinal<Math.min(end,start+offset+limit);ordinal++) {
      const row=await read(ordinal); if(row.field!==selector.field || row.value!==selector.value) throw new Error('Operation selector mismatch.'); refs.push(row.ref);
    }
    return {refs,offset:offset+refs.length,done:start+offset+refs.length===end};
  };
};
