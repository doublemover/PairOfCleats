import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';

const observationKey = Symbol.for('pairofcleats.test.semantic-serialization-work');
/** Observe real serializer calls, without changing encoding, validation or inputs. */
export const installSemanticSerializationObservation = () => {
  const identity = new URL('../../src/index/semantic/identity.js', import.meta.url).href;
  const hooks = registerHooks({ load(url, context, next) {
    const loaded = next(url, context);
    if (url !== identity) return loaded;
    const source = String(loaded.source);
    const marker = 'export const canonicalSemanticJson =';
    if (!source.includes(marker)) throw new Error('Canonical serializer observation owner changed.');
    return { ...loaded, source: source.replace(marker, 'const observedCanonicalSemanticJson =') + `
export const canonicalSemanticJson = (value, options) => {
  const result = observedCanonicalSemanticJson(value, options);
  globalThis[Symbol.for('pairofcleats.test.semantic-serialization-work')]?.(value, result);
  return result;
};` };
  } });
  return { start(root) {
    const originals = { open: fs.open, from: Buffer.from, alloc: Buffer.alloc, allocUnsafe: Buffer.allocUnsafe };
    const phases = {}, durationsMs = {};
    let phase = 'setup', changed = performance.now(), active = true;
    const row = () => phases[phase] ||= { serializerCalls: 0, envelopeCalls: 0, encodedUtf8Bytes: 0,
      bufferRequests: 0, bufferBytes: 0, opens: 0, writes: 0, writtenBytes: 0, reads: 0, readBytes: 0,
      syncs: 0, closes: 0, stats: 0, sampledPeakHeapBytes: 0 };
    const sample = () => { const value = row(); value.sampledPeakHeapBytes = Math.max(value.sampledPeakHeapBytes, process.memoryUsage().heapUsed); return value; };
    const selected = target => { const rel = path.relative(root, String(target)); return rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); };
    globalThis[observationKey] = (value, encoded) => {
      if (!active) return;
      const counter = sample(); counter.serializerCalls++; counter.encodedUtf8Bytes += Buffer.byteLength(encoded);
      if (value && Object.hasOwn(value, 'family') && Object.hasOwn(value, 'row')) counter.envelopeCalls++;
    };
    for (const name of ['from', 'alloc', 'allocUnsafe']) Buffer[name] = function (...args) {
      const result = originals[name].apply(this, args);
      if (active) { const counter = sample(); counter.bufferRequests++; counter.bufferBytes += result.byteLength; }
      return result;
    };
    fs.open = async function (target, ...args) {
      const handle = await originals.open.call(this, target, ...args);
      if (!selected(target)) return handle;
      if (active) sample().opens++;
      for (const method of ['write', 'read', 'sync', 'close', 'stat']) {
        const original = handle[method].bind(handle);
        handle[method] = async (...input) => {
          const result = await original(...input);
          if (active) {
            const counter = sample();
            if (method === 'write') { counter.writes++; counter.writtenBytes += result.bytesWritten; }
            else if (method === 'read') { counter.reads++; counter.readBytes += result.bytesRead; }
            else counter[{ sync: 'syncs', close: 'closes', stat: 'stats' }[method]]++;
          }
          return result;
        };
      }
      return handle;
    };
    const switchPhase = next => {
      const now = performance.now();
      if (active) durationsMs[phase] = (durationsMs[phase] || 0) + now - changed;
      changed = now; phase = next;
      if (next === 'observe') active = false;
    };
    return { phases, durationsMs, switchPhase, stop() {
      active = false; fs.open = originals.open;
      for (const name of ['from', 'alloc', 'allocUnsafe']) Buffer[name] = originals[name];
      delete globalThis[observationKey];
    } };
  }, stop() { hooks.deregister(); delete globalThis[observationKey]; } };
};
