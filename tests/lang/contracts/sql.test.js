#!/usr/bin/env node
import { ensureFixtureIndex, loadFixtureIndexMeta } from '../../helpers/fixture-index.js';

const { fixtureRoot, userConfig } = await ensureFixtureIndex({
  fixtureName: 'languages',
  cacheName: 'language-fixture',
  cacheScope: 'shared',
  requiredModes: ['code']
});
const { chunkMeta, resolveChunkFile } = loadFixtureIndexMeta(fixtureRoot, userConfig);

const sqlTable = chunkMeta.find((chunk) =>
  resolveChunkFile(chunk) === 'src/sql_advanced.sql'
  && String(chunk.kind || '').includes('Table')
  && String(chunk.name || '').includes('widgets')
);
if (!sqlTable) {
  console.error('Missing SQL table chunk (widgets).');
  process.exit(1);
}
if (typeof sqlTable.docmeta?.controlFlow?.branches !== 'number') {
  console.error('SQL control flow missing for widgets.');
  process.exit(1);
}

const pgTable = chunkMeta.find((chunk) =>
  resolveChunkFile(chunk) === 'src/sql_postgres.psql'
  && String(chunk.kind || '').includes('Table')
  && String(chunk.name || '').includes('pg_widgets')
);
if (!pgTable) {
  console.error('Missing Postgres SQL table chunk (pg_widgets).');
  process.exit(1);
}
if (pgTable.docmeta?.dialect !== 'postgres') {
  console.error('Postgres dialect metadata missing for pg_widgets.');
  process.exit(1);
}

console.log('SQL contract checks ok.');
