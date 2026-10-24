import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';

const index = process.argv.lastIndexOf('--repo');
if (index < 0 || !process.argv[index + 1]) throw new Error('Probe requires the exact child repository argument.');
const repoRoot = process.argv[index + 1];
const output = process.env.POC_WORKSPACE_PROBE_OUTPUT;
if (!output || !path.isAbsolute(output)) throw new Error('Probe requires its own absolute output file.');
fs.writeFileSync(output, JSON.stringify({ repoRoot, cwd: process.cwd(), args: process.argv.slice(2), execArgv: process.execArgv,
  nodeOptions: process.env.NODE_OPTIONS || null, uvThreadpoolSize: process.env.UV_THREADPOOL_SIZE || null,
  heapLimitBytes: v8.getHeapStatistics().heap_size_limit }));
if (process.env.POC_WORKSPACE_PROBE_MODE === 'fail') process.exitCode = 7;
else if (process.env.POC_WORKSPACE_PROBE_MODE === 'signal') process.kill(process.pid, 'SIGTERM');
else if (process.env.POC_WORKSPACE_PROBE_MODE === 'wait') {
  process.stderr.write('workspace-probe-ready\n');
  setInterval(() => {}, 1000);
}
