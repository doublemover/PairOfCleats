import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { stableStringifyForSignature } from '../../../src/shared/stable-json.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('producer-git-byte-authority');
const root = path.join(dir, 'producer'), relative = 'src/name-\uFFFD.js';
await fs.mkdir(path.join(root, 'src'), { recursive: true });
await fs.mkdir(path.join(root, 'node_modules'));
await fs.copyFile(new URL('../../../node_modules/.pairofcleats-bootstrap.json', import.meta.url),
  path.join(root, 'node_modules/.pairofcleats-bootstrap.json'));
const source = Buffer.from('export const literalReplacement = true;\n');
await fs.writeFile(path.join(root, relative), source);
const revision = 'a'.repeat(40), header = Buffer.from('# branch.oid ' + revision + '\0# branch.head fixture\0');
const state = { root, pathBytes: Buffer.from(relative), metadata: 'actual', captures: [], commands: [] };
globalThis.__producerGitBytes = state;
const runnerUrl = new URL('../../../src/shared/subprocess/runner.js', import.meta.url).href;
const childScript = "process.stdout.write(Buffer.from(process.argv[1], 'hex'))";
const hooks = registerHooks({ resolve(specifier, context, next) {
  const resolved = next(specifier, context);
  if (context.parentURL?.includes('/src/index/build/stage-provenance.js')) {
    if (specifier === 'node:url') return { url: 'producer-git-bytes:root', shortCircuit: true };
    if (resolved.url === runnerUrl) return { url: 'producer-git-bytes:child', shortCircuit: true };
  }
  return resolved;
}, load(url, context, next) {
  if (url === 'producer-git-bytes:root') return { format: 'module', shortCircuit: true,
    source: 'export const fileURLToPath=()=>globalThis.__producerGitBytes.root;' };
  if (url === 'producer-git-bytes:child') return { format: 'module', shortCircuit: true,
    source: 'import {spawnSubprocess as actual} from ' + JSON.stringify(runnerUrl) + ';'
      + 'export const spawnSubprocess=async(command,args,options)=>{const s=globalThis.__producerGitBytes;'
      + 's.commands.push(args);const output=args.includes("status")?Buffer.concat([s.header,Buffer.from("? "),s.pathBytes,Buffer.from([0])]):Buffer.alloc(0);'
      // Deliberately malformed Git bytes cross the ACTUAL bounded child stdout
      // collector. No invalid pathname is created; byte-loss cases retain the
      // collector's original metadata. Separate unknown-authority cases remove it.
      + 'const result=await actual(process.execPath,["-e",' + JSON.stringify(childScript) + ',output.toString("hex")],options);'
      + 's.captures.push(structuredClone(result.outputCapture));'
      + 'if(s.metadata==="unknown")delete result.outputCapture.stdout.encodingLoss;'
      + 'if(s.metadata==="absent")delete result.outputCapture;return result;};' };
  return next(url, context);
} });
state.header = header;
const sha = data => createHash('sha256').update(data).digest('hex');
let workError;
try {
  const { observeStageProducer } = await import('../../../src/index/build/stage-provenance.js?byte-authority');
  const admitted = await observeStageProducer();
  assert.equal(admitted.revision, revision); assert.equal(admitted.dirtyFiles, 1);
  assert.match(admitted.identity, /^[a-f0-9]{64}$/);
  assert.equal(admitted.dirty, sha(stableStringifyForSignature([{ path: relative, bytes: source.length, hash: sha(source) }])));
  assert.equal(state.commands.length, 4);
  assert.ok(state.captures.every(capture => capture.stdout.encodingLoss === false && capture.stdout.truncated === false));
  for (const invalid of [[0xff], [0x80], [0xc0, 0xaf], [0xe2, 0x82], [0xed, 0xa0, 0x80]]) {
    state.pathBytes = Buffer.concat([Buffer.from('src/name-'), Buffer.from(invalid), Buffer.from('.js')]);
    state.commands.length = 0; state.captures.length = 0;
    const observed = await observeStageProducer();
    console.log(JSON.stringify({ kind: 'producer-git-byte-authority', invalidBytes: invalid,
      originalCapture: state.captures[0]?.stdout, admittedIdentity: observed.identity }));
    assert.equal(observed.identity, null, 'malformed raw UTF8 must not select replacement text or manufacture missing-file authority');
    assert.equal(state.commands.length, 1, 'loss is refused before a second inventory or any pathname admission');
    assert.equal(state.captures[0].stdout.encodingLoss, true, 'the original bounded collector itself observes the raw decode loss');
    assert.equal(state.captures[0].stdout.truncated, false);
  }
  state.pathBytes = Buffer.from(relative);
  for (state.metadata of ['unknown', 'absent']) {
    state.commands.length = 0;
    assert.equal((await observeStageProducer()).identity, null, 'unknown byte authority cannot qualify Git path membership');
    assert.equal(state.commands.length, 1);
  }
  state.metadata = 'actual';
  assert.equal((await observeStageProducer()).identity, admitted.identity, 'legitimate literal U+FFFD is lossless and retains its exact original identity');
  assert.deepEqual(await fs.readFile(path.join(root, relative)), source);
} catch (error) { workError = error; }
finally {
  hooks.deregister(); delete globalThis.__producerGitBytes;
  try {
    if (workError) observeStorageResource(workError, { phase: 'producer-byte-fixture-cleanup' }).requireSettled();
    assert.ok(path.relative(process.cwd(), dir).startsWith('.tmp' + path.sep));
    await fs.rm(dir, { recursive: true, force: true });
  } catch (cleanupError) {
    workError = workError ? addStorageFailureContext(workError, {}, cleanupError, { secondaryPresent: true }) : cleanupError;
  }
}
if (workError) throw workError;
console.log('Actual bounded child capture rejects malformed raw Git UTF8/unknown authority while literal replacement-name identity stays valid.');
