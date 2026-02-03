import { buildCompatibilityKey } from '../../../contracts/compatibility.js';
import { buildTokenizationKey } from '../../../index/build/indexer/signatures.js';
import { applyAdaptiveDictConfig } from '../../../../tools/shared/dict-utils.js';

export const computeCompatibilityKey = ({ runtime, modes, sharedDiscovery }) => {
  const tokenizationKeys = {};
  const baseDictConfig = runtime.dictConfig || {};
  for (const modeItem of modes) {
    const entryCount = sharedDiscovery?.[modeItem]?.entries?.length ?? 0;
    const adaptedDictConfig = applyAdaptiveDictConfig(baseDictConfig, entryCount);
    const tokenizationRuntime = {
      commentsConfig: runtime.commentsConfig,
      dictConfig: adaptedDictConfig,
      postingsConfig: runtime.postingsConfig,
      dictSignature: runtime.dictSignature,
      segmentsConfig: runtime.segmentsConfig
    };
    tokenizationKeys[modeItem] = buildTokenizationKey(tokenizationRuntime, modeItem);
  }
  runtime.tokenizationKeys = tokenizationKeys;
  runtime.compatibilityKey = buildCompatibilityKey({ runtime, modes, tokenizationKeys });
  return tokenizationKeys;
};
