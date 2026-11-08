import assert from 'node:assert/strict';
import { exactLookupIntent } from '../../../src/retrieval/scoring/exact-intent.js';

const definition = { name: 'Widget.render', file: 'src/widget.js' };
assert.equal(exactLookupIntent('render', definition, true).symbol, true);
assert.equal(exactLookupIntent('render', definition, false).symbol, false);
assert.equal(exactLookupIntent('rendering', definition, true).factor, 1);
assert.equal(exactLookupIntent('how does render work', definition, true).factor, 1);
assert.equal(exactLookupIntent('widget.js', definition, true).file, true);
assert.equal(exactLookupIntent('get.js', definition, true).file, false);
assert.equal(exactLookupIntent('src\\widget.js', definition, true).file, true);
assert.equal(exactLookupIntent('./src/widget.js', definition, true).file, true);
assert.equal(exactLookupIntent('Render', definition, true).symbol, false);
console.log('Explicit symbol and filename intent respects token and path boundaries.');
