import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

/** Observe actual manifest construction without changing its checksum work or
 * the independent validators' hash module. Every intercepted call still runs
 * its original implementation. The probe owns no storage or native resources. */
export const createManifestWorkProbe = () => {
  const key = `fixture.manifest-work.${randomUUID()}`;
  const manifestUrl = new URL('../../src/index/build/artifacts/checksums.js', import.meta.url).href;
  const actualManifest = manifestUrl + '?' + key;
  const hashUrl = new URL('../../src/shared/hash.js', import.meta.url).href;
  const manifestModule = key + ':manifest', hashModule = key + ':hash';
  const metrics = { manifests: [], checksums: [] };
  const state = {
    async manifest(work) {
      const started = performance.now(), cpu = process.cpuUsage();
      try { return await work(); }
      finally { metrics.manifests.push({ elapsedMs: performance.now() - started, cpu: process.cpuUsage(cpu) }); }
    },
    async checksum(filename, work) {
      if (metrics.checksums.length >= 10000) throw new Error('Fixture manifest observation budget exceeded.');
      const result = await work();
      metrics.checksums.push({ filename, bytes: result.bytes, algorithm: result.algo });
      return result;
    }
  };
  globalThis[Symbol.for(key)] = state;
  const access = `globalThis[Symbol.for(${JSON.stringify(key)})]`;
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      const resolved = next(specifier, context);
      if (resolved.url === manifestUrl) return { url: manifestModule, shortCircuit: true };
      if (resolved.url === hashUrl && context.parentURL === actualManifest) return { url: hashModule, shortCircuit: true };
      return resolved;
    },
    load(url, context, next) {
      if (url === manifestModule) return { format: 'module', shortCircuit: true,
        source: `export * from ${JSON.stringify(actualManifest)};
          import { writePiecesManifest as actual } from ${JSON.stringify(actualManifest)};
          export const writePiecesManifest = (...args) => ${access}?.manifest(() => actual(...args)) ?? actual(...args);` };
      if (url === hashModule) return { format: 'module', shortCircuit: true,
        source: `export * from ${JSON.stringify(hashUrl)};
          import { checksumFileObservation as actual } from ${JSON.stringify(hashUrl)};
          export const checksumFileObservation = (filename, ...args) =>
            ${access}?.checksum(filename, () => actual(filename, ...args)) ?? actual(filename, ...args);` };
      return next(url, context);
    }
  });
  return { metrics, close() { hooks.deregister(); delete globalThis[Symbol.for(key)]; } };
};
