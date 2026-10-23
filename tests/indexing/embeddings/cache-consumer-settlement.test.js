import assert from 'node:assert/strict';
import { createBoundedWriterQueue } from '../../../tools/build/embeddings/writer-queue.js';
import { settleEmbeddingCacheConsumers } from '../../../tools/build/embeddings/cache/settle-consumers.js';
import { createTextDatabaseLifetime } from '../../../tools/build/embeddings/cache/text-database-lifetime.js';

const abort = Object.assign(new Error('cancelled write'), { name: 'AbortError', code: 'ABORT_ERR' });
const cancelled = createBoundedWriterQueue({ maxPending: 1 });
await cancelled.enqueue(async () => { throw abort; });
await assert.rejects(cancelled.onIdle(), error => error === abort);
await assert.rejects(cancelled.enqueue(async () => assert.fail('terminal admission must stop')), error => error === abort);
let released = false;
const pending = Object.freeze(Object.assign(new Error('original native owner retained'), {
  cacheOwnershipPending: true, cacheOwnershipReleased: () => released
}));
const queue = createBoundedWriterQueue({ maxPending: 1 });
await queue.enqueue(async () => { throw pending; });
await assert.rejects(queue.onIdle(), error => error === pending || error.cause === pending);
const attempts = [];
await assert.rejects(settleEmbeddingCacheConsumers({ primary: abort,
  compute: { drain: async () => { attempts.push('compute'); throw pending; } },
  reader: { drain: async () => { attempts.push('reader'); } }, writer: queue,
  shards: { close: async () => { attempts.push('shards'); } } }), error => error instanceof AggregateError
    && error.errors[0] === abort && error.errors.includes(pending));
assert.deepEqual(attempts, ['compute', 'reader', 'shards'], 'one failed drain cannot strand other original cache owners');

let closes = 0, leaseReleases = 0;
const native = { open: true, close() { closes++; if (closes === 1) throw Error('close pending'); this.open = false; return this; } };
const lifetime = createTextDatabaseLifetime(native, { resourceId: 'fixture', releaseAfterSettlement() { leaseReleases++; } });
native.close = () => assert.fail('replacement close has no authority');
await assert.rejects(lifetime.close(), error => error.cacheOwnershipPending === true);
assert.equal(leaseReleases, 0);
await lifetime.close(); assert.equal(closes, 2); assert.equal(leaseReleases, 1);

const guarded = { open: true, close() { this.open = false; } };
const guardedLifetime = createTextDatabaseLifetime(guarded, { resourceId: 'guarded', releaseAfterSettlement() { leaseReleases++; } });
await assert.rejects(guardedLifetime.close(pending));
await assert.rejects(guardedLifetime.close(), undefined, 'retry cannot omit the original resource prerequisite');
released = true; await guardedLifetime.close(); assert.equal(leaseReleases, 2);
console.log('Original cache failure, cancellation and native close owners survive queue and consumer cleanup.');
