import { defaultNormalize } from './predicates.js';

export const matchStructural = ({ chunk, structPackNeedles, structRuleNeedles, structTagNeedles, normalize = defaultNormalize }) => {
  if (!structPackNeedles.length && !structRuleNeedles.length && !structTagNeedles.length) {
    return true;
  }
  const docmetaObject = chunk?.docmeta && typeof chunk.docmeta === 'object' ? chunk.docmeta : null;
  const metaV2Object = chunk?.metaV2 && typeof chunk.metaV2 === 'object' ? chunk.metaV2 : null;
  const docmetaStructural = Array.isArray(docmetaObject?.structural) ? docmetaObject.structural : null;
  const metaV2Structural = Array.isArray(metaV2Object?.structural) ? metaV2Object.structural : null;
  const structural = (docmetaStructural && docmetaStructural.length)
    ? docmetaStructural
    : ((metaV2Structural && metaV2Structural.length)
      ? metaV2Structural
      : (docmetaStructural || metaV2Structural));
  if (!Array.isArray(structural) || !structural.length) return false;
  return structural.some((entry) => {
    if (structPackNeedles.length) {
      const packValue = normalize(entry?.pack || '');
      if (!structPackNeedles.some((needle) => packValue.includes(needle))) return false;
    }
    if (structRuleNeedles.length) {
      const ruleValue = normalize(entry?.ruleId || '');
      if (!structRuleNeedles.some((needle) => ruleValue.includes(needle))) return false;
    }
    if (structTagNeedles.length) {
      const tags = Array.isArray(entry?.tags) ? entry.tags : [];
      if (!tags.some((tag) => structTagNeedles.some((needle) => normalize(tag).includes(needle)))) {
        return false;
      }
    }
    return true;
  });
};
