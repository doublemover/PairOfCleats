import { normalizeNumber } from './core.js';

export function getBenchMirrorRefreshMs(env = process.env) {
  return normalizeNumber(env.PAIROFCLEATS_BENCH_MIRROR_REFRESH_MS);
}
