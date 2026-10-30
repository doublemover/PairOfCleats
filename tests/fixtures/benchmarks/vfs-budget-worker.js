import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { buildVfsColdStartPlan, runVfsColdStartSample } from '../../../tools/bench/vfs/cold-start-sample.js';
if (process.env.PAIROFCLEATS_TESTING !== '1') throw new Error('VFS budget worker requires the test environment.');
await requireBootstrap();
const { rootDir, mode, docs, docBytes, maxBytes } = JSON.parse(process.argv[2]);
const plan = await buildVfsColdStartPlan({ docs, docBytes, content: 'utf8' });
console.log(JSON.stringify(await runVfsColdStartSample({ mode, rootDir, plan, cacheConfig: { maxBytes } })));
