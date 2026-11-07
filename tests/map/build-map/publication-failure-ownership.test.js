import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const io = new URL('../../../src/map/build-map/io.js', import.meta.url).href;
const publication = new URL('../../../src/map/build-map/publication.js', import.meta.url).href;
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL === io + '?publication-fixture' && specifier === './publication.js') return { url: publication + '?publication-fixture', shortCircuit: true };
  if (context.parentURL === publication + '?publication-fixture' && specifier === '../../shared/json-stream/streams.js') return { url: 'map-publication-fixture:stream', shortCircuit: true };
  return next(specifier, context);
}, load(url, context, next) {
  if (url === 'map-publication-fixture:stream') return { format: 'module', shortCircuit: true, source: `
    export const createJsonWriteStream=(file,options)=>{
      const state=globalThis.mapPublicationFixture;state.atomic=options.atomic;
      const done=Promise.reject(state.secondary);done.catch(()=>{});
      return {stream:{destroyed:false,write(){return true;},end(){state.ended=true;},
        destroy(value){state.destroyedWith=value;throw state.destroyFailure;}},done};
    };` };
  return next(url, context);
} });
try {
  const { writeMapJsonStream } = await import(io + '?publication-fixture');
  for (const primary of [Object.freeze(new Error('original map encoder failure')), undefined, null, false, 0, '']) {
    let closed = false;
    const secondary = Object.assign(new Error('original publisher close pending'), {
      cacheOwnershipPending: true, cacheOwnershipReleased: () => closed
    });
    const destroyFailure = Object.freeze(new Error('destroy inspection failed'));
    const state = { secondary, destroyFailure }; globalThis.mapPublicationFixture = state;
    await assert.rejects(writeMapJsonStream({ filePath: 'unused-fixture.json', mapBase: {}, nodes: [{}], edges: [],
      guards: { nodes: { add() { throw primary; } } } }), error => {
      assert.equal(state.atomic, true); assert.equal(state.destroyedWith, primary);
      assert.equal(error.cacheOwnershipPending, true); assert.equal(error.cacheOwnershipReleased(), false);
      const seen = new Set(), found = new Set();
      const visit = value => { if (value === primary || value === secondary || value === destroyFailure) found.add(value);
        if (!value || typeof value !== 'object' || seen.has(value)) return;
        seen.add(value); if (Object.hasOwn(value, 'cause')) visit(value.cause); for (const child of value.errors || []) visit(child);
      };
      visit(error); assert.ok(found.has(primary)); assert.ok(found.has(secondary)); assert.ok(found.has(destroyFailure));
      secondary.cacheOwnershipReleased = () => true;
      assert.equal(error.cacheOwnershipReleased(), false, 'replacing a callback cannot release the original close');
      closed = true; assert.equal(error.cacheOwnershipReleased(), true); return true;
    });
  }
} finally { hooks.deregister(); delete globalThis.mapPublicationFixture; }
console.log('Actual map streaming publication preserves encoder/destroy/close failures and original settlement callbacks.');
