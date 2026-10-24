import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { toRealPathSync } from '../../../src/workspace/identity.js';

// The actual report entry point uses explicit trusted fixture implementations at
// its model/operational boundary. It cannot fall back to a bare PATH executable.
const fixture = toRealPathSync(await makeTempDir('poc-map-operational-render-'));
try {
  const repo = path.join(fixture, 'repo'), index = path.join(fixture, 'index');
  await fs.mkdir(repo);
  await writePiecesManifest(path.join(index, 'index-code'), []);
  const model = { version: 'fixture', root: {}, nodes: [], edges: [], summary: {}, options: {} };
  const preload = path.join(fixture, 'trusted-boundaries.mjs');
  for (const scenario of ['svg', 'html', 'unavailable', 'pending']) {
    const trace = path.join(fixture, `${scenario}-trace.json`);
    const adapter = `import fs from 'node:fs/promises';
      export async function runOperationalCommand(input) {
        if (input.id !== 'graphviz' || input.repoRoot !== ${JSON.stringify(repo)} || JSON.stringify(input.args) !== '["-Tsvg"]') throw new Error('Unexpected operational selection');
        if (input.options.maxOutputBytes !== 16777216 || input.options.timeoutMs !== 30000 || !input.options.input.startsWith('digraph CodeMap')) throw new Error('Unbounded or malformed render');
        await fs.writeFile(${JSON.stringify(trace)}, JSON.stringify({id:input.id,args:input.args}));
        if (${JSON.stringify(scenario)} === 'pending') throw Object.assign(new Error('original renderer remains active'), {cacheOwnershipPending:true,cacheOwnershipReleased:()=>false});
        if (${JSON.stringify(scenario)} === 'unavailable') throw Object.assign(new Error('selected SVG plugin unavailable'), {code:'ERR_OPERATIONAL_TOOL_UNAVAILABLE'});
        return {exitCode:0,stdout:'<svg xmlns="http://www.w3.org/2000/svg"><text>verified render</text></svg>',stderr:''};
      }`;
    const modelAdapter = `export const buildCodeMap = async () => (${JSON.stringify(model)});
      export const buildNodeList = () => []; export const buildMapCacheKey = () => 'trusted-fixture';`;
    await fs.writeFile(preload, `import {registerHooks} from 'node:module'; registerHooks({load(url,context,next){
      if(url.endsWith('/tools/tooling/operational-execution.js')) return {format:'module',shortCircuit:true,source:${JSON.stringify(adapter)}};
      if(url.endsWith('/src/map/build-map.js')) return {format:'module',shortCircuit:true,source:${JSON.stringify(modelAdapter)}};
      return next(url,context);}});`);
    const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(fixture, 'cache'),
      extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${pathToFileURL(preload).href}`.trim() } });
    const out = path.join(fixture, `${scenario}.svg`);
    const child = runNode(['tools/reports/report-code-map.js', '--repo', repo, '--index-root', index,
      '--cache-dir', path.join(fixture, `cache-${scenario}`), '--format', scenario === 'html' ? 'html' : 'svg',
      '--out', out, '--json'], `map-${scenario}`, process.cwd(), env,
    { timeoutMs: 5000, stdio: 'pipe', allowFailure: true });
    assert.equal(child.status, scenario === 'svg' || scenario === 'html' ? 0 : 1, child.stderr);
    assert.deepEqual(JSON.parse(await fs.readFile(trace, 'utf8')), { id: 'graphviz', args: ['-Tsvg'] });
    if (scenario === 'pending') {
      assert.notEqual(child.status, 0); assert.equal(child.stdout, '');
      assert.match(child.stderr, /original renderer remains active/);
      await assert.rejects(fs.stat(out), { code: 'ENOENT' });
      await assert.rejects(fs.stat(path.join(fixture, `${scenario}.dot`)), { code: 'ENOENT' });
    } else {
      const report = JSON.parse(child.stdout);
      assert.equal(child.status, scenario === 'unavailable' ? 1 : 0, child.stderr);
      assert.equal(report.ok, scenario !== 'unavailable');
      if (scenario === 'unavailable') {
        assert.equal(report.error.code, 'ERR_MAP_RENDER_FORMAT_UNAVAILABLE');
        assert.equal(report.format, 'dot');
        assert.match(await fs.readFile(report.outPath, 'utf8'), /^digraph CodeMap/);
        assert.deepEqual(report.warnings, ['selected SVG plugin unavailable']);
      } else {
        assert.deepEqual(report.warnings, []);
        const rendered = await fs.readFile(out, 'utf8');
        if (scenario === 'html') {
          const source = /src="data:image\/svg\+xml;utf8,([^"]+)"/.exec(rendered);
          assert.ok(source, 'HTML retains the actual rendered SVG image');
          assert.match(decodeURIComponent(source[1]), /verified render/);
        } else assert.match(rendered, /verified render/);
      }
    }
  }
} finally { await rmDirRecursive(fixture); }
console.log('Actual map reports use bounded operational SVG selection and preserve unsettled renderer ownership.');
