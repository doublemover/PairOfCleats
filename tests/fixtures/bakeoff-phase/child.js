import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

if (process.env.PAIROFCLEATS_TESTING !== '1') throw new Error('Inert bakeoff phase fixture requires the test environment.');
const [mode, releasePath] = process.argv.slice(2);
process.stderr.write('fixture child ready; no provider work\n');
if (mode === 'pending' || mode === 'cancel') {
  const deadline = Date.now() + 4000;
  while (true) {
    try { await fs.stat(releasePath); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (Date.now() >= deadline) throw new Error('Parent did not release the inert child while it was pending.');
    await delay(10);
  }
}
if (mode === 'invalid') process.stdout.write('{"unfinished":');
else if (mode === 'failed') { process.stderr.write('fixture primary failure\n'); process.exitCode = 7; }
else process.stdout.write(JSON.stringify({ ok: true, fixture: 'bakeoff-phase', mode }));
