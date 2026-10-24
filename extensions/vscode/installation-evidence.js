const { createChunkAccumulator } = require('./runtime.js');

function parseCliVersion(stdout, stderr) {
  const lines = [stdout, stderr].map(value => String(value || '').trim()).filter(Boolean);
  if (lines.length !== 1 || lines[0].length > 256) return null;
  const match = /^(?:PairOfCleats\s+)?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/i.exec(lines[0]);
  return match ? match[1] : null;
}

/** Read-only version evidence uses the same child owner as editor commands.
 * Raw output is never copied into the settings report. */
async function inspectCliVersion({ spawn, stop, command, args, cwd, env, timeoutMs = 3000 }) {
  const spawned = spawn(command, args, { cwd, env, shell: false, windowsHide: true });
  if (!spawned.ok) return { state: 'unobserved', reason: 'CLI version command could not start.' };
  const child = spawned.child;
  const stdout = createChunkAccumulator(8192), stderr = createChunkAccumulator(8192);
  return new Promise(resolve => {
    let settled = false, rejection = '';
    const finish = evidence => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(evidence);
    };
    const reject = reason => {
      if (settled || rejection) return;
      rejection = reason;
      Promise.resolve(stop(child)).then(() => finish({ state: 'unobserved', reason }),
        () => finish({ state: 'unobserved', reason }));
    };
    const timer = setTimeout(() => reject('CLI version observation timed out; owned termination remains tracked.'), timeoutMs);
    timer.unref?.();
    child.stdout?.on('data', chunk => {
      if (settled) return;
      stdout.push(chunk);
      if (stdout.truncated()) reject('CLI version output exceeded its 8 KiB stream bound.');
    });
    child.stderr?.on('data', chunk => {
      if (settled) return;
      stderr.push(chunk);
      if (stderr.truncated()) reject('CLI version output exceeded its 8 KiB stream bound.');
    });
    child.once('error', () => finish({ state: 'unobserved', reason: 'CLI version command failed to execute.' }));
    child.once('close', code => {
      if (rejection) { finish({ state: 'unobserved', reason: rejection }); return; }
      const version = code === 0 && !stdout.truncated() && !stderr.truncated()
        ? parseCliVersion(stdout.text(), stderr.text()) : null;
      finish(version ? { state: 'observed', version, observedAt: new Date().toISOString() }
        : { state: 'unobserved', reason: 'CLI version response was unavailable or not a single supported version identity.' });
    });
  });
}

module.exports = { parseCliVersion, inspectCliVersion };
