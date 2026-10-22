import path from 'node:path';
import { safeJoinUnderBase } from './map-iso-safe-join.js';

/** The preview and benchmark servers share this narrow module/asset closure. */
export const resolveMapViewerAsset = (toolRoot, pathname) => {
  const exact = {
    '/shared/config.js': 'src/shared/config.js',
    '/shared/iterables.js': 'src/shared/iterables.js',
    '/workspace/inspect.js': 'src/map/workspace/inspect.js'
  };
  if (Object.hasOwn(exact, pathname)) return safeJoinUnderBase(toolRoot, exact[pathname]);
  for (const [prefix, relative] of [
    ['/three/examples/', 'node_modules/three/examples'], ['/three/', 'node_modules/three/build'],
    ['/assets/isomap/', 'assets/isomap'], ['/isomap/', 'src/map/isometric/client']
  ]) {
    if (pathname.startsWith(prefix)) return safeJoinUnderBase(path.join(toolRoot, relative), pathname.slice(prefix.length));
  }
  return null;
};
