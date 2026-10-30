import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { runSqliteArtifactBenchmark } from '../../../tools/bench/sqlite/build-from-artifacts.js';
if (process.env.PAIROFCLEATS_TESTING !== '1') throw new Error('Artifact trial worker requires the test environment.');
await requireBootstrap();
const { trialOffset } = JSON.parse(process.argv[2]);
await runSqliteArtifactBenchmark({ chunks: 32768, profile: 'wide', trials: 1, mode: 'compare' }, { trialOffset });
