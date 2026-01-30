const defaultNormalize = (value) => String(value || '').toLowerCase();

export const matchStructural = ({ chunk, structPackNeedles, structRuleNeedles, structTagNeedles, normalize = defaultNormalize }) => {
  if (!structPackNeedles.length && !structRuleNeedles.length && !structTagNeedles.length) {
    return true;
  }
  const structural = chunk?.docmeta?.structural;
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
