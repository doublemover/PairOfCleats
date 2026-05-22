#!/usr/bin/env node
import { ensureFixtureIndex, loadFixtureIndexMeta } from '../../helpers/fixture-index.js';
import { fail, findSafely, hasPython, runEnabledCases } from '../helpers/fixture-metadata.js';

const { fixtureRoot, userConfig } = await ensureFixtureIndex({
  fixtureName: 'languages',
  cacheName: 'language-fixture',
  cacheScope: 'shared',
  requiredModes: ['code']
});
const { chunkMeta, fileMeta, resolveChunkFile } = loadFixtureIndexMeta(fixtureRoot, userConfig);

const findChunk = (predicate) => findSafely(chunkMeta, predicate);

const pythonEnabled = hasPython();

if (!Array.isArray(chunkMeta) || chunkMeta.length === 0) {
  fail('Language fixture chunk_meta.json missing or empty.');
}

const sampleChunk = chunkMeta.find((chunk) => chunk && (chunk.file || chunk.fileId));
const resolvedFile = sampleChunk ? resolveChunkFile(sampleChunk) : null;
if (!resolvedFile) {
  fail('Language fixture chunk_meta entries missing file references.');
}

if (fileMeta && !Array.isArray(fileMeta)) {
  fail('Language fixture file_meta.json should be an array.');
}

const cases = [
  {
    label: 'Go struct doc metadata',
    enabled: true,
    find: () => findChunk((chunk) =>
      resolveChunkFile(chunk) === 'src/go_advanced.go'
      && String(chunk.kind || '').includes('Struct')
      && String(chunk.name || '').includes('Widget')
    ),
    validate: (chunk) => {
      if (!chunk) fail('Missing Go struct chunk (Widget).');
      if (!String(chunk.docmeta?.doc || '').includes('Widget holds a name')) {
        fail('Go docstring missing for Widget struct.');
      }
    }
  },
  {
    label: 'Go function control flow',
    enabled: true,
    find: () => findChunk((chunk) =>
      resolveChunkFile(chunk) === 'src/go_advanced.go'
      && String(chunk.kind || '').includes('Function')
      && String(chunk.name || '').includes('MakeWidget')
    ),
    validate: (chunk) => {
      if (!chunk) fail('Missing Go function chunk (MakeWidget).');
      const controlFlow = chunk.docmeta?.controlFlow;
      if (!controlFlow || !(controlFlow.returns >= 1)) {
        fail('Go controlFlow missing returns for MakeWidget.');
      }
    }
  },
  {
    label: 'JavaScript class inheritance',
    enabled: true,
    find: () => findChunk((chunk) => {
      if (!chunk || resolveChunkFile(chunk) !== 'src/javascript_advanced.js') return false;
      if (chunk.name !== 'Widget') return false;
      return chunk.kind === 'ClassDeclaration'
        || chunk.kind === 'ExportedClass'
        || chunk.kind === 'ExportDefaultClassDeclaration';
    }),
    validate: (chunk) => {
      if (!chunk) fail('Missing JS class chunk (Widget).');
      const bases = chunk.docmeta?.extends || [];
      if (!bases.includes('BaseWidget')) {
        fail('JS class metadata missing BaseWidget extends.');
      }
    }
  },
  {
    label: 'JavaScript async method modifiers',
    enabled: true,
    find: () => findChunk((chunk) =>
      resolveChunkFile(chunk) === 'src/javascript_advanced.js'
      && String(chunk.name || '').includes('Widget.load')
    ),
    validate: (chunk) => {
      if (!chunk) fail('Missing JS async method chunk (Widget.load).');
      if (!chunk.docmeta?.modifiers?.async) {
        fail('JS async modifier missing for Widget.load.');
      }
    }
  },
  {
    label: 'Python dataclass fields',
    enabled: pythonEnabled,
    skipMessage: 'Skipping Python language-fixture contract checks (python not available).',
    find: () => findChunk((chunk) =>
      resolveChunkFile(chunk) === 'src/python_advanced.py'
      && String(chunk.name || '').includes('Point')
      && String(chunk.kind || '').includes('Class')
    ),
    validate: (chunk) => {
      if (!chunk) fail('Missing Python dataclass chunk (Point).');
      const fieldNames = (chunk.docmeta?.fields || []).map((field) => field.name);
      if (!fieldNames.includes('x') || !fieldNames.includes('y')) {
        fail('Python dataclass fields missing for Point (expected x,y).');
      }
    }
  },
  {
    label: 'Python async metadata',
    enabled: pythonEnabled,
    find: () => findChunk((chunk) =>
      resolveChunkFile(chunk) === 'src/python_advanced.py'
      && String(chunk.name || '').includes('fetch_data')
    ),
    validate: (chunk) => {
      if (!chunk) fail('Missing Python async chunk (fetch_data).');
      if (!chunk.docmeta?.async) {
        fail('Python async metadata missing for fetch_data.');
      }
    }
  },
  {
    label: 'SQL table control flow',
    enabled: true,
    find: () => findChunk((chunk) =>
      resolveChunkFile(chunk) === 'src/sql_advanced.sql'
      && String(chunk.kind || '').includes('Table')
      && String(chunk.name || '').includes('widgets')
    ),
    validate: (chunk) => {
      if (!chunk) fail('Missing SQL table chunk (widgets).');
      if (typeof chunk.docmeta?.controlFlow?.branches !== 'number') {
        fail('SQL control flow missing for widgets.');
      }
    }
  },
  {
    label: 'Postgres dialect metadata',
    enabled: true,
    find: () => findChunk((chunk) =>
      resolveChunkFile(chunk) === 'src/sql_postgres.psql'
      && String(chunk.kind || '').includes('Table')
      && String(chunk.name || '').includes('pg_widgets')
    ),
    validate: (chunk) => {
      if (!chunk) fail('Missing Postgres SQL table chunk (pg_widgets).');
      if (chunk.docmeta?.dialect !== 'postgres') {
        fail('Postgres dialect metadata missing for pg_widgets.');
      }
    }
  },
  {
    label: 'TypeScript class inheritance',
    enabled: true,
    find: () => findChunk((chunk) =>
      resolveChunkFile(chunk) === 'src/typescript_advanced.ts'
      && chunk.kind === 'ClassDeclaration'
      && chunk.name === 'Widget'
    ),
    validate: (chunk) => {
      if (!chunk) fail('Missing TypeScript class chunk (Widget).');
      const extendsList = chunk.docmeta?.extends || [];
      if (!extendsList.some((name) => String(name).includes('BaseWidget'))) {
        fail('TypeScript extends metadata missing BaseWidget.');
      }
    }
  },
  {
    label: 'TypeScript function control flow',
    enabled: true,
    find: () => findChunk((chunk) =>
      resolveChunkFile(chunk) === 'src/typescript_advanced.ts'
      && chunk.kind === 'FunctionDeclaration'
      && String(chunk.name || '').includes('makeWidget')
    ),
    validate: (chunk) => {
      if (!chunk) fail('Missing TypeScript function chunk (makeWidget).');
      const controlFlow = chunk.docmeta?.controlFlow;
      if (!controlFlow || !(controlFlow.returns >= 1)) {
        fail('TypeScript controlFlow missing returns for makeWidget.');
      }
    }
  }
];

if (!pythonEnabled) {
  console.log('Skipping Python language-fixture contract checks (python not available).');
}

await runEnabledCases(cases);

console.log('Language fixture contracts ok.');
