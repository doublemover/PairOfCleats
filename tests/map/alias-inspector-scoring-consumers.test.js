import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildCodeMap } from '../../src/map/build-map.js';
import { createRepoMapIterator } from '../../src/index/build/artifacts/writers/repo-map.js';
import { prepareArtifactIoTestDir, writePiecesManifest } from '../helpers/artifact-io-fixture.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { assertMapConsumerComposition } from '../helpers/map-consumer-assertions.js';

const dir = await prepareArtifactIoTestDir('map-alias-inspector-scoring-consumers');
applyTestEnv({ cacheRoot: path.join(dir, 'cache') });
const scenarios = [
  ['canonical', { dataflow: { aliases: ['a=b', 'c=d', 'e=f', 'g=h', 'i=j'] } }, {}, ['a=b', 'c=d', 'e=f', 'g=h', 'i=j']],
  ['legacy', {}, { dataflow: { aliases: ['legacy-a', 'legacy-b', 'legacy-c', 'legacy-d'] } }, ['legacy-a', 'legacy-b', 'legacy-c', 'legacy-d']],
  ['mixed', { dataflow: { reads: ['input'], aliases: ['canonical-a', 'canonical-b', 'canonical-c', 'canonical-d'] } },
    { dataflow: { aliases: ['stale-legacy'] } }, ['canonical-a', 'canonical-b', 'canonical-c', 'canonical-d']],
  ['empty', { dataflow: { aliases: [] } }, { dataflow: { aliases: ['stale-legacy'] } }, []],
  ['malformed', { dataflow: { aliases: ['valid', null, 7, {}, ''] } }, {}, ['valid']]
];
try {
  for (const [scenario, meta, docmeta, expected] of scenarios) {
    const chunks = [{ id: 0, file: 'source.js', name: 'subject', kind: 'function', start: 0, end: 24,
      startLine: 1, endLine: 1, docmeta, metaV2: { chunkUid: 'chunk:' + scenario,
        symbol: { symbolId: 'sym:v1:' + scenario }, ...meta } }];
    const repoMap = [...createRepoMapIterator({ chunks, fileRelations: new Map() })()];
    const pieces = [];
    for (const [name, value] of Object.entries({ chunk_meta: chunks, repo_map: repoMap,
      file_meta: [{ id: 0, file: 'source.js', ext: '.js' }], file_relations: [] })) {
      await fs.writeFile(path.join(dir, name + '.json'), JSON.stringify(value));
      pieces.push({ name, path: name + '.json', format: 'json' });
    }
    await writePiecesManifest(dir, pieces);
    const normal = await buildCodeMap({ repoRoot: dir, indexDir: dir, options: {} });
    assert.equal(normal.edges.some(edge => edge.type === 'alias'), false, 'default includes remain unchanged');
    const explicit = JSON.parse(JSON.stringify(await buildCodeMap({ repoRoot: dir, indexDir: dir,
      options: { include: ['aliases'] } })));
    assert.equal(explicit.nodes.length, 1); assert.equal(explicit.summary.counts.members, 1);
    const id = explicit.nodes[0].members[0].id;
    assert.equal(id, 'sym:v1:' + scenario);
    await assertMapConsumerComposition(explicit, { aliases: new Map([[id, expected]]) });
    if (expected.length > 1) {
      const capped = await buildCodeMap({ repoRoot: dir, indexDir: dir,
        options: { include: ['aliases'], maxEdges: 1 } });
      assert.equal(capped.edges.length, 1);
      assert.equal(capped.summary.dropped.edges, expected.length - 1, 'caps report the exact omitted aliases');
    }
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Actual canonical/legacy producer → map → hierarchy → inspector/scoring preserves full alias evidence.');
