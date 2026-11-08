import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { buildVfsColdStartPlan, runVfsColdStartSample } from '../../../tools/bench/vfs/cold-start-sample.js';
if (process.env.PAIROFCLEATS_TESTING !== '1') throw new Error('VFS phase worker requires the test environment.');
await requireBootstrap();
const { rootDir, mode, docs, docBytes, content } = JSON.parse(process.argv[2]);
const started = performance.now();
const plan = await buildVfsColdStartPlan({ docs, docBytes, content });
const documentPlanMs = performance.now() - started;
console.log(JSON.stringify({ ...await runVfsColdStartSample({ mode, rootDir, plan }), documentPlanMs }));
