const clampLevels = (value, fallback = 256) => {
  const rawLevels = Number(value);
  let levels = Number.isFinite(rawLevels) ? Math.floor(rawLevels) : fallback;
  if (!Number.isFinite(levels)) levels = fallback;
  if (levels < 2) levels = 2;
  if (levels > 256) levels = 256;
  return levels;
};

const resolveNumeric = (value, fallback) => (
  Number.isFinite(value) ? Number(value) : fallback
);

export function resolveQuantizationParams(quantization = {}) {
  const minSource = quantization?.minVal ?? quantization?.min_val;
  const maxSource = quantization?.maxVal ?? quantization?.max_val;
  const levelsSource = quantization?.levels;
  return {
    minVal: resolveNumeric(minSource, -1),
    maxVal: resolveNumeric(maxSource, 1),
    levels: clampLevels(levelsSource, 256)
  };
}

export function resolveDenseMetaRecord(
  denseMeta = {},
  {
    fallbackDims = 0,
    fallbackModel = null,
    defaultScale = 2 / 255
  } = {}
) {
  const quantization = resolveQuantizationParams(denseMeta);
  const range = quantization.maxVal - quantization.minVal;
  const scale = Number.isFinite(denseMeta?.scale)
    ? Number(denseMeta.scale)
    : (Number.isFinite(range) && range !== 0
      ? (range / (quantization.levels - 1))
      : defaultScale);
  const dims = Number.isFinite(denseMeta?.dims)
    ? Number(denseMeta.dims)
    : fallbackDims;
  const model = denseMeta?.model || fallbackModel;
  return {
    ...quantization,
    dims,
    model,
    scale
  };
}
