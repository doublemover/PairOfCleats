import fs from 'node:fs/promises';
import { once } from 'node:events';

const args = process.argv.slice(2), mode = args[0], out = args[1];
const payload = { canaryMetrics: { resultClass: 'passed', productionCleanStatus: 'clean',
  taskCount: 1, crashCount: 0, timeoutClasses: [], countsByDiagnosticType: {}, countsByFailureClass: {} } };
const write = async (stream, value) => { if (!stream.write(value)) await once(stream, 'drain'); };
if (mode === 'timeout') await new Promise(() => { setInterval(() => {}, 1000); });
else if (mode === 'malformed') await fs.writeFile(out, '{"canaryMetrics":');
else if (mode === 'oversized') await fs.writeFile(out, JSON.stringify({ ...payload, padding: 'x'.repeat(8192) }));
else if (mode === 'unreadable') await fs.mkdir(out);
else if (mode === 'invalid-schema') await fs.writeFile(out, '[]');
else if (mode === 'invalid-encoding') await fs.writeFile(out, Buffer.concat([Buffer.from('{"canaryMetrics":'), Buffer.from([0xff]), Buffer.from('}')]));
else if (mode === 'missing') process.stdout.write('no result');
else {
  if (mode === 'flood' || mode === 'truncated-stdout') {
    const rune = Buffer.from('€');
    await write(process.stdout, rune.subarray(0, 1));
    await write(process.stdout, rune.subarray(1));
    for (let i = 0; i < 32; i++) {
      await write(process.stdout, Buffer.alloc(4096, 120));
      await write(process.stderr, Buffer.alloc(4096, 121));
    }
  }
  if (mode === 'stdout' || mode === 'truncated-stdout') await write(process.stdout, JSON.stringify(payload));
  else await fs.writeFile(out, JSON.stringify(payload));
  if (mode === 'nonzero') process.exitCode = 9;
}
