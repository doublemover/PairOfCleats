import assert from 'node:assert/strict';
import { createFilterEnumeration, enumerateFilterMatches } from '../../../src/retrieval/pipeline/filter-enumeration.js';
const meta = Array.from({ length: 5000 }, (_, id) => ({ id, file: 'same.js' }));
const create = () => createFilterEnumeration({ filters: {}, modes: ['code'], generation: { buildId: 'accounting' } });
const requests = Array.from({ length: 8 }, () => create());
await Promise.all(requests.map(enumeration => enumerateFilterMatches({ meta, mode: 'code', topN: 1, enumeration })));
const warm = create();
assert.equal((await enumerateFilterMatches({ meta, mode: 'code', topN: 1, enumeration: warm })).length, 1);
assert.equal(warm.byMode.code.cost.scannedMetadata, 0);
assert.equal(warm.byMode.code.cost.cacheBytes, meta.length * 4,
  'overlapping same-key admissions replace one byte charge rather than leaking charges');
console.log('Overlapping enumeration admission charges each retained representation once.');
