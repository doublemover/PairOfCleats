import { GO_SDK_ARCHIVE_LIMITS, GO_SDK_MAX_DOWNLOAD_BYTES } from '../../src/shared/managed-go.js';

export const GOPLS_VERSION = '0.24.0';
export const GOPLS_PACKAGE = `golang.org/x/tools/gopls@v${GOPLS_VERSION}`;
const MiB = 1024 * 1024, GiB = 1024 * MiB;

/** Maintained cold-build forecasts for this pinned recipe, not measured peaks
 * or filesystem quotas. Forecasts cover the declared destination routes;
 * native/vendor secondary-write and actual peak qualification remain separate.
 * Never reuse these amounts for a different package or an arbitrary command. */
export const createGoplsCacheRecipe = binDir => ({
  cmd: 'go', args: ['install', GOPLS_PACKAGE], env: { GOBIN: binDir },
  requires: 'go', minimumGoVersion: 'go1.27.0',
  storageEstimate: { complete: false, basis: 'canonical-build-forecast-v1',
    recipe: `gopls-v${GOPLS_VERSION}`, measured: false, writes: [
      { destination: 'artifacts', requiredBytes: GiB },
      { destination: 'scratch', requiredBytes: 2 * GiB },
      { environmentKey: 'GOPATH', requiredBytes: 64 * MiB },
      { environmentKey: 'GOMODCACHE', requiredBytes: 2 * GiB },
      { environmentKey: 'GOCACHE', requiredBytes: 2 * GiB }
    ] },
  // The separate SDK owner enforces these archive/extracted byte ceilings.
  // Its reservation finishes before the package build starts.
  goSdkStorageEstimate: { complete: true, basis: 'bounded-archive-owner-v1', writes: [
    { destination: 'artifacts', requiredBytes: GO_SDK_ARCHIVE_LIMITS.maxBytes + GO_SDK_MAX_DOWNLOAD_BYTES + 32 * MiB }
  ] }
});
