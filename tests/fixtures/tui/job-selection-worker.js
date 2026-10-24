// Explicit inert workload for the native selection qualification transport.
// Real supervisor routing, cancellation and process ownership remain in use.
const label = process.argv[2];
let completed = 0;
const emit = () => {
  completed++;
  process.stdout.write(JSON.stringify({ proto: 'poc.progress@2', event: 'task:progress',
    ts: new Date().toISOString(), taskId: `${label}_TASK`, current: completed, total: 10000,
    unit: 'files', stage: label.toLowerCase() }) + '\n');
  process.stderr.write(`${label}_ONLY_LOG_${completed}\n`);
};
emit();
setInterval(emit, 75);
setTimeout(() => { console.error('Selection fixture exceeded its lifetime'); process.exit(79); }, 20000);
