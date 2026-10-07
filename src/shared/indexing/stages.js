export const INDEX_BUILD_STAGE_ORDER = Object.freeze({
  stage1: 1,
  stage2: 2,
  stage3: 3,
  stage4: 4
});

export const normalizeIndexBuildStage = (raw) => {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!value) return null;
  if (value === '1' || value === 'stage1' || value === 'sparse') return 'stage1';
  if (value === '2' || value === 'stage2' || value === 'enrich' || value === 'full') return 'stage2';
  if (value === '3' || value === 'stage3' || value === 'embeddings' || value === 'embed') return 'stage3';
  if (value === '4' || value === 'stage4' || value === 'sqlite' || value === 'ann') return 'stage4';
  return null;
};

export const isKnownIndexBuildStage = (stage) => (
  Object.prototype.hasOwnProperty.call(INDEX_BUILD_STAGE_ORDER, stage)
);

export const isIndexBuildStageAtLeast = ({ requested, existing } = {}) => {
  if (!requested) return true;
  const target = INDEX_BUILD_STAGE_ORDER[requested] || 0;
  const current = INDEX_BUILD_STAGE_ORDER[existing] || 0;
  return current >= target;
};
