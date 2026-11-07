import { createReuseFixture, assertReuseSourceContract } from './reuse-fixture.js';

await assertReuseSourceContract(await createReuseFixture('incremental-reuse-source-authority'));
console.log('Incremental source reuse verifies real bytes and preserves deletion/stat/content negatives without physical links.');
