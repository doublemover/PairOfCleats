#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createCli } from '../../../src/shared/cli.js';
import { toPosix } from '../../../src/shared/files.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const argv = createCli({
  scriptName: 'fixture-medium-generate',
  options: {
    out: { type: 'string' },
    count: { type: 'number', default: 5000 },
    seed: { type: 'string', default: 'medium-fixture' },
    clean: { type: 'boolean', default: false }
  }
}).parse();

const outRoot = argv.out
  ? path.resolve(argv.out)
  : path.join(repoRoot, 'tests', '.cache', 'fixtures', 'medium');
const fileCount = Number.isFinite(argv.count)
  ? Math.max(1, Math.floor(argv.count))
  : 5000;
const seed = String(argv.seed || 'medium-fixture');

const hashSeed = (value) => {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const createRng = (value) => {
  let state = hashSeed(value);
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const rng = createRng(seed);
const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];

const templates = [
  {
    dir: path.join('src', 'js'),
    ext: 'js',
    render: (i) => {
      const word = words[i % words.length];
      const n = Math.floor(rng() * 1000);
      return [
        `export function fn_${i}(input) {`,
        `  const tag = '${word}-${i}';`,
        `  return input + ${n};`,
        '}',
        ''
      ].join('\n');
    }
  },
  {
    dir: path.join('src', 'ts'),
    ext: 'ts',
    render: (i) => {
      const n = Math.floor(rng() * 1000);
      return [
        `export interface Widget${i} {`,
        '  id: number;',
        '  name: string;',
        '}',
        `export const widget${i}: Widget${i} = { id: ${n}, name: 'widget-${i}' };`,
        ''
      ].join('\n');
    }
  },
  {
    dir: path.join('src', 'py'),
    ext: 'py',
    render: (i) => {
      const n = Math.floor(rng() * 1000);
      return [
        `def handler_${i}(value: int) -> int:`,
        `    return value + ${n}`,
        ''
      ].join('\n');
    }
  },
  {
    dir: path.join('docs'),
    ext: 'md',
    render: (i) => {
      const word = words[(i + 3) % words.length];
      return [
        `# Note ${i}`,
        '',
        `This is the ${word} fixture entry for file ${i}.`,
        '',
        '```js',
        `export const sample = ${i};`,
        '```',
        ''
      ].join('\n');
    }
  },
  {
    dir: path.join('web'),
    ext: 'html',
    render: (i) => {
      const n = Math.floor(rng() * 1000);
      return [
        '<!doctype html>',
        '<html>',
        '  <head>',
        '    <style>.card{padding:8px;border:1px solid #ccc;}</style>',
        '  </head>',
        '  <body>',
        `    <div class="card">Item ${i}</div>`,
        '    <script>',
        `      const value = ${n};`,
        '      console.log(value);',
        '    </script>',
        '  </body>',
        '</html>',
        ''
      ].join('\n');
    }
  }
];

if (argv.clean) {
  await fsPromises.rm(outRoot, { recursive: true, force: true });
}

await fsPromises.mkdir(outRoot, { recursive: true });

const manifest = {
  seed,
  fileCount,
  generatedAt: new Date().toISOString(),
  filesByExt: {},
  totalBytes: 0,
  contentHash: ''
};
const hash = crypto.createHash('sha1');

for (let i = 0; i < fileCount; i += 1) {
  const template = templates[i % templates.length];
  const group = Math.floor(i / 500);
  const dir = path.join(outRoot, template.dir, `group-${group}`);
  await fsPromises.mkdir(dir, { recursive: true });
  const fileName = `file-${i}.${template.ext}`;
  const content = template.render(i);
  const relPath = path.join(template.dir, `group-${group}`, fileName);
  await fsPromises.writeFile(path.join(outRoot, relPath), content, 'utf8');
  manifest.filesByExt[template.ext] = (manifest.filesByExt[template.ext] || 0) + 1;
  manifest.totalBytes += Buffer.byteLength(content, 'utf8');
  hash.update(toPosix(relPath));
  hash.update('\n');
  hash.update(content);
  hash.update('\n');
}

manifest.contentHash = `sha1:${hash.digest('hex')}`;
await fsPromises.writeFile(
  path.join(outRoot, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8'
);

console.log(`Generated medium fixture at ${outRoot} (${fileCount} files).`);
