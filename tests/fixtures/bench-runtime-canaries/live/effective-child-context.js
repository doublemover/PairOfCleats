import fs from 'node:fs';

const args = process.argv.slice(2), probe = args.indexOf('--probe'), out = args.indexOf('--out');
const marker = probe >= 0 ? args[probe + 1] : 'child';
if (process.env.CANARY_CONTEXT_TRACE) fs.appendFileSync(process.env.CANARY_CONTEXT_TRACE,
  JSON.stringify({ marker, cwd: process.cwd(), threads: process.env.PAIROFCLEATS_THREADS }) + '\n');
if (probe >= 0) process.stdout.write('fixture-version-' + marker + '\n');
else {
  const payload = { resultClass: 'passed', productionCleanStatus: 'clean', taskCount: 1,
    crashCount: 0, countsByDiagnosticType: {}, countsByFailureClass: {}, timeoutClasses: [] };
  if (out >= 0) fs.writeFileSync(args[out + 1], JSON.stringify(payload));
  else process.stdout.write(JSON.stringify(payload));
}
