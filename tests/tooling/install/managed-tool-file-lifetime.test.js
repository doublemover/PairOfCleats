// UNVALIDATED: original descriptor methods and deferred close, no native launch.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hasClangdTargetHeader, resolveManagedClangd } from '../../../src/shared/managed-clangd.js';
import { hashManagedToolFile, readManagedToolText } from '../../../src/shared/managed-tool-file.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('managed-tool-file-lifetime/')[1];
assert.ok(['header-close', 'hash-close', 'text-close', 'header-read', 'hash-read', 'text-read', 'discovery-read'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`managed-tool-file-${selected}`);
applyTestEnv({ cacheRoot: path.join(dir, 'cache') });
const toolingRoot = path.join(dir, 'tools');
const file = selected === 'discovery-read' ? path.join(toolingRoot, 'servers', 'clangd', 'current.json') : path.join(dir, 'fixture.bin');
const bytes = Buffer.alloc(64);
Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(bytes); bytes.writeUInt16LE(0x3e, 18);
fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes);
const originalOpen = fs.openSync, originalRead = fs.readSync, originalClose = fs.closeSync;
let fd = null, reads = 0, closes = 0, replacements = 0, ready = false, session = null;
const original = Object.freeze(Object.assign(new Error('original managed binary read remains pending'), {
  cacheOwnershipReleased() { assert.equal(this, original); return ready; }
}));
const invoke = () => {
  if (selected.startsWith('header-')) return hasClangdTargetHeader(file, { platform: 'linux', arch: 'x64' });
  if (selected.startsWith('hash-')) return hashManagedToolFile(file);
  if (selected.startsWith('text-')) return readManagedToolText(file);
  return resolveManagedClangd(toolingRoot, { platform: 'win32', arch: 'x64' });
};
try {
  fs.openSync = (...args) => { const opened = originalOpen(...args); if (args[0] === file) fd = opened; return opened; };
  fs.closeSync = opened => { closes++; const result = originalClose(opened); if (opened === fd) fd = null; return result; };
  fs.readSync = (...args) => {
    if (args[0] !== fd) return originalRead(...args);
    reads++;
    if (selected.endsWith('-close')) {
      fs.closeSync = () => { replacements++; throw new Error('replacement close must never be selected'); };
      return originalRead(...args);
    }
    throw original;
  };
  if (selected.endsWith('-close')) {
    assert.ok(invoke()); assert.equal(closes, 1); assert.equal(replacements, 0);
    assert.equal(fd, null, 'the original physical close ran after the borrowed read');
  } else {
    let pending;
    assert.throws(invoke, error => { pending = error; return error.cacheOwnershipPending === true && errorGraphIncludes(error, original); });
    session = getContainedFileSession(pending);
    assert.ok(session, 'discovery retains the original read owner instead of returning missing');
    assert.equal(closes, 0, 'an original pending operation prohibits native close');
    assert.throws(() => session.releaseAfterCloseSync()); assert.equal(closes, 0);
    ready = true; const settled = session.releaseAfterCloseSync();
    assert.equal(settled.resourceId, session.resourceId); assert.equal(settled.settled, true); assert.equal(settled.pending, false);
    assert.equal(closes, 1); assert.equal(reads, 1, 'settlement never replays payload reads or publishes a success witness');
  }
} finally {
  fs.openSync = originalOpen; fs.readSync = originalRead; fs.closeSync = originalClose;
  ready = true;
  if (session && !session.isSettled()) session.releaseAfterCloseSync();
  if (fd !== null) originalClose(fd);
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`Managed tool file ${selected}: original resource lifetime retained.`);
