import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

const root = process.cwd();
const sources = [fs.readFileSync('tests/fixtures/languages/src/perl_advanced.pl', 'utf8'),
  "my $x = <<'END';\n$END\n\\END\nsub fake { die 'literal'; }\nEND\nsub actual { return $x; }\n",
  "my ($a, $b) = (<<~'FIRST', <<'SECOND');\n  one\n  FIRST\n  SECOND\nSECOND\nprint $a, $b;\n"];
const script = `
  const { parentPort, workerData } = require('node:worker_threads');
  const { createRequire } = require('node:module');
  const load = createRequire(workerData.packageFile);
  const Parser = load('tree-sitter');
  const language = load('@ganezdragon/tree-sitter-perl');
  function run() {
    const parser = new Parser(); parser.setLanguage(language);
    try {
      for (const source of workerData.sources) {
        parser.reset();
        const tree = parser.parse(source);
        try {
          if (tree.rootNode.hasError) throw Error(tree.rootNode.toString());
          if (source.includes('sub fake') && (tree.rootNode.descendantsOfType('heredoc_end_identifier').length !== 1
            || tree.rootNode.descendantsOfType('function_definition').length !== 1)) throw Error('literal escaped heredoc');
        } finally { tree.delete?.(); }
      }
    } finally { parser.delete?.(); }
  }
  for (let i=0; i<16; i++) run();
  parentPort.postMessage('ready');
  if (workerData.cancel) while (true) run();
`;
for (const cancel of [false, true]) {
  const worker = new Worker(script, { eval: true, workerData: { sources, cancel, packageFile: path.join(root, 'package.json') } });
  const exited = new Promise((resolve, reject) => { worker.once('exit', resolve); worker.once('error', reject); });
  const timer = setTimeout(() => { void worker.terminate(); }, 10000);
  try {
    const ready = await new Promise((resolve, reject) => {
      worker.once('message', resolve); worker.once('error', reject);
      worker.once('exit', code => reject(Error('worker exited before ready: ' + code)));
    });
    assert.equal(ready, 'ready');
    if (cancel) assert.equal(await worker.terminate(), 1);
    else assert.equal(await exited, 0);
  } finally { clearTimeout(timer); await worker.terminate(); }
}
console.log('Fresh real Perl parser workers disposed naturally and during outstanding parse work.');
