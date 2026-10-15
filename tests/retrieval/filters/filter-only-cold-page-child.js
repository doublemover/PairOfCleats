import { createFilterEnumeration, enumerateFilterMatches, buildFilterPagination } from '../../../src/retrieval/pipeline/filter-enumeration.js';
const { cacheDir, cursor = null, generation = { id: 'cold-pages' } } = JSON.parse(process.argv[2]);
const filters = { type: 'FunctionDeclaration' };
const meta = Array.from({ length: 10000 }, (_, id) => ({ id, file: 'src/' + id + '.ts', kind: 'FunctionDeclaration' }));
const enumeration = createFilterEnumeration({ cacheDir, cursor, generation, filters, modes: ['code'] });
const code = await enumerateFilterMatches({ meta, mode: 'code', topN: 997, enumeration, match: row => row.kind === filters.type });
console.log(JSON.stringify({ ids: code.map(row => row.id), pagination: buildFilterPagination(enumeration, { code }) }));
