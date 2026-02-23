/**
 * Resolve write-lane concurrency for light/heavy artifact queues.
 *
 * @param {object} input
 * @param {number} input.writeConcurrency
 * @param {number} input.lightWrites
 * @param {number} input.heavyWrites
 * @param {number|null} [input.heavyWriteConcurrencyOverride]
 * @param {number} [input.hostConcurrency]
 * @returns {{heavyConcurrency:number,lightConcurrency:number}}
 */
export const resolveArtifactLaneConcurrency = ({
  writeConcurrency,
  lightWrites,
  heavyWrites,
  heavyWriteConcurrencyOverride = null,
  hostConcurrency = 1
}) => {
  const totalWriteConcurrency = Math.max(1, Math.floor(Number(writeConcurrency) || 1));
  const lightWriteCount = Math.max(0, Math.floor(Number(lightWrites) || 0));
  const heavyWriteCount = Math.max(0, Math.floor(Number(heavyWrites) || 0));
  const availableHostConcurrency = Math.max(1, Math.floor(Number(hostConcurrency) || 1));
  const heavyOverride = Number(heavyWriteConcurrencyOverride);
  const dynamicHeavyTarget = Number.isFinite(heavyOverride) && heavyOverride > 0
    ? Math.max(1, Math.floor(heavyOverride))
    : (heavyWriteCount >= 8 && availableHostConcurrency >= 8
      ? Math.max(1, Math.ceil(totalWriteConcurrency * 0.66))
      : Math.max(1, Math.ceil(totalWriteConcurrency / 2)));

  const hasHeavy = heavyWriteCount > 0;
  const hasLight = lightWriteCount > 0;

  if (!hasHeavy && !hasLight) {
    return { heavyConcurrency: 0, lightConcurrency: 0 };
  }
  if (!hasHeavy) {
    return {
      heavyConcurrency: 0,
      lightConcurrency: Math.min(totalWriteConcurrency, lightWriteCount)
    };
  }
  if (!hasLight) {
    return {
      // Heavy-only queues should consume full writer concurrency; memory pressure
      // is already bounded by scheduler tokens and per-write mem costs.
      heavyConcurrency: Math.min(totalWriteConcurrency, heavyWriteCount),
      lightConcurrency: 0
    };
  }

  const heavySkewedBacklog = heavyWriteCount >= Math.max(4, lightWriteCount * 2);
  const lightReserveRatio = heavySkewedBacklog ? 0.2 : 0.33;
  const lightReserveFloor = heavySkewedBacklog ? 2 : 1;
  const lightReserveCap = Math.max(0, totalWriteConcurrency - 1);
  const effectiveLightReserveFloor = Math.min(lightReserveCap, lightReserveFloor);
  const lightReserve = lightReserveCap > 0
    ? Math.max(
      effectiveLightReserveFloor,
      Math.min(
        lightWriteCount,
        lightReserveCap,
        Math.ceil(totalWriteConcurrency * lightReserveRatio)
      )
    )
    : 0;
  const maxHeavyBudget = Math.max(1, totalWriteConcurrency - lightReserve);
  let heavyConcurrency = Math.max(
    1,
    Math.min(heavyWriteCount, dynamicHeavyTarget, maxHeavyBudget)
  );
  let lightConcurrencyBudget = Math.max(0, totalWriteConcurrency - heavyConcurrency);
  const minimumLightBudget = Math.min(lightWriteCount, lightReserve);
  if (lightConcurrencyBudget < minimumLightBudget && heavyConcurrency > 1) {
    const shift = Math.min(
      minimumLightBudget - lightConcurrencyBudget,
      heavyConcurrency - 1
    );
    heavyConcurrency -= shift;
    lightConcurrencyBudget += shift;
  }
  const lightConcurrency = Math.min(lightWriteCount, lightConcurrencyBudget);

  return {
    heavyConcurrency,
    lightConcurrency
  };
};

/**
 * Resolve write-lane concurrency when an ultra-light queue is present.
 *
 * Ultra-light artifacts reserve at least one slot (bounded) whenever mixed with
 * other lanes so tiny metadata writes never wait behind long heavy tails.
 *
 * @param {object} input
 * @param {number} input.writeConcurrency
 * @param {number} input.ultraLightWrites
 * @param {number} input.lightWrites
 * @param {number} input.heavyWrites
 * @param {number|null} [input.heavyWriteConcurrencyOverride]
 * @param {number} [input.hostConcurrency]
 * @returns {{ultraLightConcurrency:number,lightConcurrency:number,heavyConcurrency:number}}
 */
export const resolveArtifactLaneConcurrencyWithUltraLight = ({
  writeConcurrency,
  ultraLightWrites,
  lightWrites,
  heavyWrites,
  heavyWriteConcurrencyOverride = null,
  hostConcurrency = 1
}) => {
  const totalWriteConcurrency = Math.max(1, Math.floor(Number(writeConcurrency) || 1));
  const ultraLightWriteCount = Math.max(0, Math.floor(Number(ultraLightWrites) || 0));
  const lightWriteCount = Math.max(0, Math.floor(Number(lightWrites) || 0));
  const heavyWriteCount = Math.max(0, Math.floor(Number(heavyWrites) || 0));
  if (!ultraLightWriteCount && !lightWriteCount && !heavyWriteCount) {
    return {
      ultraLightConcurrency: 0,
      lightConcurrency: 0,
      heavyConcurrency: 0
    };
  }
  if (!lightWriteCount && !heavyWriteCount) {
    return {
      ultraLightConcurrency: Math.min(totalWriteConcurrency, ultraLightWriteCount),
      lightConcurrency: 0,
      heavyConcurrency: 0
    };
  }

  const ultraLightReserveTarget = ultraLightWriteCount > 0
    ? Math.max(1, Math.min(2, Math.ceil(totalWriteConcurrency * 0.25)))
    : 0;
  const maxUltraReserve = Math.max(0, totalWriteConcurrency - 1);
  let ultraLightConcurrency = ultraLightWriteCount > 0
    ? Math.min(ultraLightWriteCount, ultraLightReserveTarget, maxUltraReserve)
    : 0;
  if (ultraLightWriteCount > 0 && ultraLightConcurrency < 1 && totalWriteConcurrency > 0) {
    ultraLightConcurrency = 1;
  }
  const remainingConcurrency = Math.max(0, totalWriteConcurrency - ultraLightConcurrency);
  if (remainingConcurrency <= 0) {
    return {
      ultraLightConcurrency,
      lightConcurrency: 0,
      heavyConcurrency: 0
    };
  }
  const base = resolveArtifactLaneConcurrency({
    writeConcurrency: remainingConcurrency,
    lightWrites: lightWriteCount,
    heavyWrites: heavyWriteCount,
    heavyWriteConcurrencyOverride,
    hostConcurrency
  });
  if (base.lightConcurrency === 0 && base.heavyConcurrency === 0 && ultraLightWriteCount > 0) {
    ultraLightConcurrency = Math.min(totalWriteConcurrency, ultraLightWriteCount);
  }
  return {
    ultraLightConcurrency,
    lightConcurrency: base.lightConcurrency,
    heavyConcurrency: base.heavyConcurrency
  };
};

/**
 * Resolve lane concurrency with ultra-light + massive write lanes.
 *
 * Massive artifacts reserve dedicated slots and tokens so very large outputs
 * (packed/binary-columnar/field postings) do not monopolize the general lane.
 *
 * @param {object} input
 * @param {number} input.writeConcurrency
 * @param {number} input.ultraLightWrites
 * @param {number} input.massiveWrites
 * @param {number} input.lightWrites
 * @param {number} input.heavyWrites
 * @param {number|null} [input.heavyWriteConcurrencyOverride]
 * @param {number} [input.hostConcurrency]
 * @returns {{ultraLightConcurrency:number,massiveConcurrency:number,lightConcurrency:number,heavyConcurrency:number}}
 */
export const resolveArtifactLaneConcurrencyWithMassive = ({
  writeConcurrency,
  ultraLightWrites,
  massiveWrites,
  lightWrites,
  heavyWrites,
  heavyWriteConcurrencyOverride = null,
  hostConcurrency = 1
}) => {
  const totalWriteConcurrency = Math.max(1, Math.floor(Number(writeConcurrency) || 1));
  const ultraLightWriteCount = Math.max(0, Math.floor(Number(ultraLightWrites) || 0));
  const massiveWriteCount = Math.max(0, Math.floor(Number(massiveWrites) || 0));
  const lightWriteCount = Math.max(0, Math.floor(Number(lightWrites) || 0));
  const heavyWriteCount = Math.max(0, Math.floor(Number(heavyWrites) || 0));
  if (!ultraLightWriteCount && !massiveWriteCount && !lightWriteCount && !heavyWriteCount) {
    return {
      ultraLightConcurrency: 0,
      massiveConcurrency: 0,
      lightConcurrency: 0,
      heavyConcurrency: 0
    };
  }
  if (!massiveWriteCount && !lightWriteCount && !heavyWriteCount) {
    return {
      ultraLightConcurrency: Math.min(totalWriteConcurrency, ultraLightWriteCount),
      massiveConcurrency: 0,
      lightConcurrency: 0,
      heavyConcurrency: 0
    };
  }
  if (!ultraLightWriteCount && !lightWriteCount && !heavyWriteCount) {
    return {
      ultraLightConcurrency: 0,
      massiveConcurrency: Math.min(totalWriteConcurrency, massiveWriteCount),
      lightConcurrency: 0,
      heavyConcurrency: 0
    };
  }

  const nonUltraWriteCount = massiveWriteCount + lightWriteCount + heavyWriteCount;
  const ultraLightReserveTarget = ultraLightWriteCount > 0
    ? Math.max(1, Math.min(2, Math.ceil(totalWriteConcurrency * 0.25)))
    : 0;
  const maxUltraReserve = Math.max(0, totalWriteConcurrency - (nonUltraWriteCount > 0 ? 1 : 0));
  let ultraLightConcurrency = ultraLightWriteCount > 0
    ? Math.min(ultraLightWriteCount, ultraLightReserveTarget, maxUltraReserve)
    : 0;
  if (ultraLightWriteCount > 0 && ultraLightConcurrency < 1 && totalWriteConcurrency > 0) {
    ultraLightConcurrency = 1;
  }

  const regularWriteCount = lightWriteCount + heavyWriteCount;
  const remainingAfterUltra = Math.max(0, totalWriteConcurrency - ultraLightConcurrency);
  if (regularWriteCount === 0) {
    return {
      ultraLightConcurrency,
      massiveConcurrency: Math.min(massiveWriteCount, remainingAfterUltra),
      lightConcurrency: 0,
      heavyConcurrency: 0
    };
  }
  const massiveReserveTarget = massiveWriteCount > 0
    ? Math.max(1, Math.min(2, Math.ceil(totalWriteConcurrency * 0.33)))
    : 0;
  const maxMassiveReserve = Math.max(0, remainingAfterUltra - (regularWriteCount > 0 ? 1 : 0));
  let massiveConcurrency = massiveWriteCount > 0
    ? Math.min(massiveWriteCount, massiveReserveTarget, maxMassiveReserve)
    : 0;
  if (
    massiveWriteCount > 0
    && massiveConcurrency < 1
    && remainingAfterUltra > 0
    && regularWriteCount > 0
  ) {
    massiveConcurrency = 1;
  }

  const remainingConcurrency = Math.max(
    0,
    totalWriteConcurrency - ultraLightConcurrency - massiveConcurrency
  );
  if (remainingConcurrency <= 0) {
    return {
      ultraLightConcurrency,
      massiveConcurrency,
      lightConcurrency: 0,
      heavyConcurrency: 0
    };
  }

  const base = resolveArtifactLaneConcurrency({
    writeConcurrency: remainingConcurrency,
    lightWrites: lightWriteCount,
    heavyWrites: heavyWriteCount,
    heavyWriteConcurrencyOverride,
    hostConcurrency
  });
  return {
    ultraLightConcurrency,
    massiveConcurrency,
    lightConcurrency: base.lightConcurrency,
    heavyConcurrency: base.heavyConcurrency
  };
};

/**
 * Resolve independent work-class concurrency budgets.
 *
 * Work classes map to write lanes as:
 * `small -> ultraLight+light`, `medium -> heavy`, `large -> massive`.
 *
 * @param {object} input
 * @param {number} input.writeConcurrency
 * @param {number} input.smallWrites
 * @param {number} input.mediumWrites
 * @param {number} input.largeWrites
 * @param {number|null} [input.smallConcurrencyOverride]
 * @param {number|null} [input.mediumConcurrencyOverride]
 * @param {number|null} [input.largeConcurrencyOverride]
 * @param {number} [input.hostConcurrency]
 * @returns {{smallConcurrency:number,mediumConcurrency:number,largeConcurrency:number}}
 */
export const resolveArtifactWorkClassConcurrency = ({
  writeConcurrency,
  smallWrites,
  mediumWrites,
  largeWrites,
  smallConcurrencyOverride = null,
  mediumConcurrencyOverride = null,
  largeConcurrencyOverride = null,
  hostConcurrency = 1
}) => {
  const totalWriteConcurrency = Math.max(1, Math.floor(Number(writeConcurrency) || 1));
  const smallWriteCount = Math.max(0, Math.floor(Number(smallWrites) || 0));
  const mediumWriteCount = Math.max(0, Math.floor(Number(mediumWrites) || 0));
  const largeWriteCount = Math.max(0, Math.floor(Number(largeWrites) || 0));
  if (!smallWriteCount && !mediumWriteCount && !largeWriteCount) {
    return {
      smallConcurrency: 0,
      mediumConcurrency: 0,
      largeConcurrency: 0
    };
  }

  const parseOverride = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.max(1, Math.floor(parsed));
  };
  const clampToWrites = (value, count) => Math.max(0, Math.min(count, Math.floor(Number(value) || 0)));

  const seeded = resolveArtifactLaneConcurrencyWithMassive({
    writeConcurrency: totalWriteConcurrency,
    ultraLightWrites: 0,
    massiveWrites: largeWriteCount,
    lightWrites: smallWriteCount,
    heavyWrites: mediumWriteCount,
    hostConcurrency
  });

  const smallOverride = parseOverride(smallConcurrencyOverride);
  const mediumOverride = parseOverride(mediumConcurrencyOverride);
  const largeOverride = parseOverride(largeConcurrencyOverride);
  let budgets = {
    smallConcurrency: clampToWrites(
      smallOverride ?? seeded.lightConcurrency,
      smallWriteCount
    ),
    mediumConcurrency: clampToWrites(
      mediumOverride ?? seeded.heavyConcurrency,
      mediumWriteCount
    ),
    largeConcurrency: clampToWrites(
      largeOverride ?? seeded.massiveConcurrency,
      largeWriteCount
    )
  };

  let totalBudget = budgets.smallConcurrency + budgets.mediumConcurrency + budgets.largeConcurrency;
  if (totalBudget > totalWriteConcurrency) {
    let overflow = totalBudget - totalWriteConcurrency;
    for (const className of ['smallConcurrency', 'mediumConcurrency', 'largeConcurrency']) {
      if (overflow <= 0) break;
      const shift = Math.min(overflow, budgets[className]);
      budgets[className] -= shift;
      overflow -= shift;
    }
    totalBudget = budgets.smallConcurrency + budgets.mediumConcurrency + budgets.largeConcurrency;
  }

  if (totalBudget < totalWriteConcurrency) {
    let spare = totalWriteConcurrency - totalBudget;
    const remainingCapacity = {
      largeConcurrency: Math.max(0, largeWriteCount - budgets.largeConcurrency),
      mediumConcurrency: Math.max(0, mediumWriteCount - budgets.mediumConcurrency),
      smallConcurrency: Math.max(0, smallWriteCount - budgets.smallConcurrency)
    };
    for (const className of ['largeConcurrency', 'mediumConcurrency', 'smallConcurrency']) {
      if (spare <= 0) break;
      const grow = Math.min(spare, remainingCapacity[className]);
      budgets[className] += grow;
      spare -= grow;
    }
  }

  return budgets;
};

export const clampWriteConcurrency = (value, fallback = 1) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Math.max(1, Math.floor(Number(fallback) || 1));
  }
  return Math.max(1, Math.floor(parsed));
};

/**
 * Resolve artifact write start timestamp for queue-delay/stall telemetry.
 *
 * Prefetched writes may provide a pre-dispatch timestamp; non-prefetched
 * writes should use the current dispatch time instead of coercing nullish
 * values (for example `Number(null) === 0`, which skews elapsed metrics).
 *
 * @param {number|string|null|undefined} prefetchedStartMs
 * @param {number} [fallbackNowMs]
 * @returns {number}
 */
export const resolveWriteStartTimestampMs = (prefetchedStartMs, fallbackNowMs = Date.now()) => {
  const fallback = Number.isFinite(Number(fallbackNowMs))
    ? Number(fallbackNowMs)
    : Date.now();
  const prefetched = Number(prefetchedStartMs);
  if (Number.isFinite(prefetched) && prefetched > 0) return prefetched;
  return fallback;
};
