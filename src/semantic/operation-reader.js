import { assertSemanticOperationIndex } from '../contracts/validators/semantic-operation-index.js';
import { canonicalSemanticJson } from '../index/semantic/identity.js';
import { compareOperationIndexRows, OPERATION_INDEX_FIELDS } from './operation-index.js';
import { throwIfAborted } from '../shared/abort.js';
import { SOURCE_ORDER_FIELD, captureSourceEnumeration, sourcePathBounds, decodeSourceOrderPath, captureSourcePath, captureSourceOrderCursor } from './source-order.js';
export const validateOperationSelector = (selector, offset, limit) => {
  if (!selector || Object.keys(selector).sort().join(',') !== 'field,value' || (!OPERATION_INDEX_FIELDS.includes(selector.field) || selector.field === SOURCE_ORDER_FIELD)
    || typeof selector.value !== 'string' || !selector.value.length || selector.value.length > 4096
    || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 128) throw new TypeError('Invalid operation selector or page allowance.');
};
export const captureOperationSelector = (input, offset, limit) => {
  const fail = () => new TypeError('Invalid operation selector or page allowance.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail();
  for (const key in input) {
    if (Object.hasOwn(input, key) && key !== 'field' && key !== 'value') throw fail();
  }
  const selector = {};
  for (const key of ['field', 'value']) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw fail();
    selector[key] = descriptor.value;
  }
  validateOperationSelector(selector, offset, limit);
  return Object.freeze(selector);
};
export const createArtifactOperationReader = ({ index, inventory, generation, readPieceRows, getReadScope = () => null }) => {
  let checked = false;
  const access = ({ signal = null, metrics = null } = {}) => {
    throwIfAborted(signal);
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
      if(metrics)metrics.operationIndexProbes=(metrics.operationIndexProbes||0)+1;
      const scope=getReadScope(),memo=scope?.operationRows;
      if(memo?.has(ordinal)){
        if(metrics)metrics.operationIndexMemoHits=(metrics.operationIndexMemoHits||0)+1;
        return memo.get(ordinal);
      }
      let low = 0, high = index.pieces.length - 1, piece;
      while (low <= high) { const mid = (low+high) >>> 1, candidate=index.pieces[mid];
        if (ordinal < candidate.firstRow) high=mid-1; else if (ordinal >= candidate.firstRow+candidate.count) low=mid+1; else { piece=candidate; break; } }
      if (!piece) throw new Error('Operation index row out of range.');
      if(metrics)metrics.operationIndexRowReads=(metrics.operationIndexRowReads||0)+1;
      const [row]=await readPieceRows(piece,[ordinal-piece.firstRow],{maxBytes:1048576,signal,metrics});
      assertSemanticOperationIndex(row,{rowOnly:true});
      if (compareOperationIndexRows(row,piece.firstKey)<0 || compareOperationIndexRows(row,piece.lastKey)>0) throw new Error('Operation index key mismatch.');
      const owned=Object.freeze({...row,ref:Object.freeze({...row.ref})});
      const charge=512+2*(row.field.length+row.value.length+row.ref.partitionId.length);
      if(memo&&!memo.has(ordinal)&&scope.readers.has(piece)&&memo.size<128
        &&scope.readerBytes+scope.operationRowBytes+charge<=scope.operationMemoMaxBytes){
        memo.set(ordinal,owned);scope.operationRowBytes+=charge;
        if(metrics)metrics.operationIndexMemoBytes=Math.max(metrics.operationIndexMemoBytes||0,scope.operationRowBytes);
      }
      return owned;
    };
    const bound = async (field, value, upper = false, ref = null) => {
      let low=0,high=index.rowCount;
      while(low<high) { const mid=Math.floor((low+high)/2),row=await read(mid);
        let comparison=row.field===field ? row.value===value ? 0 : row.value<value ? -1:1 : row.field<field ? -1:1;
        if (comparison === 0 && ref) comparison = row.ref.partitionId === ref.partitionId ? row.ref.localId - ref.localId : row.ref.partitionId < ref.partitionId ? -1 : 1;
        if(comparison<0 || upper && comparison===0) low=mid+1; else high=mid; }
      return low;
    };
    return { read, bound };
  };
  const find = async (selector, { offset = 0, limit = 128, signal = null, metrics = null } = {}) => {
    selector = captureOperationSelector(selector, offset, limit);
    const { read, bound } = access({ signal, metrics });
    const ranges = getReadScope()?.operationRanges;
    const rangeKey = canonicalSemanticJson(selector);
    let range = ranges?.get(rangeKey);
    if (!range) {
      range = (async () => ({ start: await bound(selector.field, selector.value), end: await bound(selector.field, selector.value, true) }))();
      // At most sixteen 4-KiB selector identities per logical scope; this is
      // request-local metadata, never a persisted verification certificate.
      if (ranges && ranges.size < 16) ranges.set(rangeKey, range);
    }
    const { start, end } = await range, refs = [];
    if(offset>end-start) throw new Error('Operation cursor exceeds selected inventory.');
    for(let ordinal=start+offset;ordinal<Math.min(end,start+offset+limit);ordinal++) {
      const row=await read(ordinal); if(row.field!==selector.field || row.value!==selector.value) throw new Error('Operation selector mismatch.'); refs.push({...row.ref});
    }
    return {refs,offset:offset+refs.length,done:start+offset+refs.length===end};
  };
  find.assertSourceOrderAvailable = options => { access(options); };
  find.listSourcePaths = async (input, options = {}) => {
    const { ranges, afterKey, limit, after } = captureSourceEnumeration(input);
    const { read, bound } = access(options), paths = [];
    for (const range of ranges) {
      if (afterKey !== null && afterKey >= range.upper) continue;
      let ordinal = await bound(SOURCE_ORDER_FIELD, afterKey === null || afterKey < range.lower ? range.lower : afterKey);
      while (ordinal < index.rowCount && paths.length <= limit) {
        const row = await read(ordinal);
        if (row.field !== SOURCE_ORDER_FIELD || row.value >= range.upper) break;
        if (row.value < range.lower) throw new Error('Source enumeration index range mismatch.');
        const sourcePath = captureSourcePath(decodeSourceOrderPath(row.value));
        paths.push(sourcePath);
        if (options.metrics) options.metrics.sourceEnumerationPaths = (options.metrics.sourceEnumerationPaths || 0) + 1;
        ordinal = await bound(SOURCE_ORDER_FIELD, sourcePathBounds(sourcePath).upper);
      }
      if (paths.length > limit) break;
    }
    return { paths: paths.slice(0, limit), after: paths.length ? paths[Math.min(limit, paths.length) - 1] : after,
      done: paths.length <= limit };
  };
  find.inSourceOrder = async (sourcePath, { after = null, limit = 128, signal = null, metrics = null } = {}) => {
    const range = sourcePathBounds(sourcePath);
    after = captureSourceOrderCursor(sourcePath, after);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128) throw new TypeError('Invalid source-order page allowance.');
    const { read, bound } = access({ signal, metrics });
    let ordinal = after ? await bound(SOURCE_ORDER_FIELD, after.value, true, after.ref) : await bound(SOURCE_ORDER_FIELD, range.lower);
    const end = await bound(SOURCE_ORDER_FIELD, range.upper), refs = [];
    let next = after;
    while (ordinal < end && refs.length < limit) {
      const row = await read(ordinal++);
      if (row.field !== SOURCE_ORDER_FIELD || decodeSourceOrderPath(row.value) !== sourcePath) throw new Error('Source-order index mismatch.');
      refs.push({ ...row.ref }); next = { value: row.value, ref: { ...row.ref } };
    }
    return { refs, after: next, done: ordinal >= end };
  };
  return find;
};
