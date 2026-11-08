import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createMapSelectedIndexFixture } from '../../helpers/map-selected-index-fixture.js';

// The existing capable authority cohort owns this physical alias. Ordinary
// Windows CI runs the portable identity case without creating a new link.
const fixture = await createMapSelectedIndexFixture('alias');
const { temp, a, b, map, names, cacheFiles } = fixture;
try {
  assert.deepEqual(names(map()), ['bravoOrigin']);
  assert.equal((await cacheFiles()).length, 1);
  const first = map(a); assert.deepEqual(names(first), ['alphaOrigin']);
  assert.deepEqual(names(map(b)), ['bravoOrigin']);
  assert.equal((await cacheFiles()).length, 3);
  const alias = path.join(temp, 'index-a-alias');
  await fs.symlink(a, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(map(alias), first, 'directory aliases canonicalize to the selected index');
  assert.equal((await cacheFiles()).length, 3, 'the alias cannot create another selected-generation cache');
} finally { await fixture.close(); }
