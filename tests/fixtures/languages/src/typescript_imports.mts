import {
  alpha,
  type Beta
} from 'lib-alpha';

export { gamma } from 'lib-beta';

export async function loadFeature() {
  const mod = await import('lib-gamma');
  return mod;
}

const legacy = require('lib-delta');
export { legacy };
