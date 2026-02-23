import { coerceUnitFraction } from '../number-coerce.js';
import {
  ADAPTIVE_SURFACE_KEYS,
  DEFAULT_ADAPTIVE_SURFACE_POLICY,
  DEFAULT_ADAPTIVE_SURFACE_QUEUE_MAP
} from './adaptive-surfaces.js';
import {
  normalizeBacklogRatio,
  normalizeCooldownMs,
  normalizePositiveInt,
  normalizeQueueName,
  normalizeRatio,
  normalizeSurfaceName
} from './scheduler-core-normalize.js';

/**
 * Resolve default adaptive concurrency bounds from computed scheduler limits.
 *
 * @param {string} surfaceName
 * @param {{cpu:number,io:number,mem:number}} maxLimits
 * @returns {{minConcurrency:number,maxConcurrency:number,initialConcurrency:number}}
 */
const resolveSurfaceDefaultBounds = (surfaceName, maxLimits) => {
  const cpuHeadroom = Math.max(1, maxLimits.cpu);
  const ioHeadroom = Math.max(1, maxLimits.io);
  switch (surfaceName) {
    case 'parse':
      return {
        minConcurrency: 1,
        maxConcurrency: Math.max(1, Math.ceil(cpuHeadroom * 0.9)),
        initialConcurrency: Math.max(1, Math.ceil(cpuHeadroom * 0.75))
      };
    case 'inference':
      return {
        minConcurrency: 1,
        maxConcurrency: Math.max(1, Math.ceil(cpuHeadroom * 0.75)),
        initialConcurrency: Math.max(1, Math.ceil(cpuHeadroom * 0.5))
      };
    case 'artifactWrite':
      return {
        minConcurrency: 1,
        maxConcurrency: Math.max(1, Math.ceil(ioHeadroom * 0.85)),
        initialConcurrency: Math.max(1, Math.ceil(ioHeadroom * 0.6))
      };
    case 'sqlite': {
      const sharedCap = Math.max(1, Math.min(cpuHeadroom, ioHeadroom));
      return {
        minConcurrency: 1,
        maxConcurrency: Math.max(1, Math.ceil(sharedCap * 0.6)),
        initialConcurrency: Math.max(1, Math.ceil(sharedCap * 0.5))
      };
    }
    case 'embeddings':
      return {
        minConcurrency: 1,
        maxConcurrency: Math.max(1, Math.ceil(cpuHeadroom * 0.8)),
        initialConcurrency: Math.max(1, Math.ceil(cpuHeadroom * 0.55))
      };
    default:
      return {
        minConcurrency: 1,
        maxConcurrency: Math.max(1, cpuHeadroom),
        initialConcurrency: 1
      };
  }
};

/**
 * Initialize adaptive-surface controller state and queue-to-surface mappings.
 *
 * @param {{input:object,maxLimits:{cpu:number,io:number,mem:number}}} input
 * @returns {{
 *   adaptiveSurfaceControllersEnabled:boolean,
 *   adaptiveSurfaceStates:Map<string, any>,
 *   resolveQueueSurface:(queueName:string, explicitSurface?:string|null)=>string|null,
 *   adaptiveDecisionTrace:object[],
 *   appendAdaptiveDecision:(entry:any)=>void,
 *   nextAdaptiveDecisionId:()=>number
 * }}
 */
export const createAdaptiveSurfaceControllerState = ({ input, maxLimits }) => {
  const isObject = (value) => (
    value && typeof value === 'object' && !Array.isArray(value)
  );
  const adaptiveEnabled = input.adaptive === true;
  const adaptiveSurfaceRoot = isObject(input.adaptiveSurfaces)
    ? input.adaptiveSurfaces
    : {};
  const adaptiveSurfaceConfig = isObject(adaptiveSurfaceRoot.surfaces)
    ? adaptiveSurfaceRoot.surfaces
    : adaptiveSurfaceRoot;
  const adaptiveSurfaceControllersEnabled = adaptiveEnabled
    && adaptiveSurfaceRoot.enabled !== false;
  const adaptiveSurfaceDecisionTraceMax = normalizePositiveInt(
    adaptiveSurfaceRoot.decisionTraceMaxSamples
      ?? input.adaptiveDecisionTraceMaxSamples,
    512
  ) || 512;
  const adaptiveDecisionTrace = [];
  let adaptiveDecisionId = 0;
  const appendAdaptiveDecision = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    adaptiveDecisionTrace.push(entry);
    while (adaptiveDecisionTrace.length > adaptiveSurfaceDecisionTraceMax) {
      adaptiveDecisionTrace.shift();
    }
  };
  const nextAdaptiveDecisionId = () => {
    adaptiveDecisionId += 1;
    return adaptiveDecisionId;
  };
  const surfaceQueueMap = new Map(Object.entries(DEFAULT_ADAPTIVE_SURFACE_QUEUE_MAP));
  const adaptiveSurfaceStates = new Map();
  for (const surfaceName of ADAPTIVE_SURFACE_KEYS) {
    const defaults = DEFAULT_ADAPTIVE_SURFACE_POLICY[surfaceName]
      || DEFAULT_ADAPTIVE_SURFACE_POLICY.parse;
    const bounds = resolveSurfaceDefaultBounds(surfaceName, maxLimits);
    const config = isObject(adaptiveSurfaceConfig?.[surfaceName])
      ? adaptiveSurfaceConfig[surfaceName]
      : {};
    const explicitQueues = Array.isArray(config.queues)
      ? config.queues
        .map((entry) => normalizeQueueName(entry))
        .filter(Boolean)
      : [];
    if (explicitQueues.length) {
      for (const queueName of explicitQueues) {
        surfaceQueueMap.set(queueName, surfaceName);
      }
    }
    const minConcurrency = Math.max(
      1,
      normalizePositiveInt(config.minConcurrency, bounds.minConcurrency) || bounds.minConcurrency
    );
    const maxConcurrency = Math.max(
      minConcurrency,
      normalizePositiveInt(config.maxConcurrency, bounds.maxConcurrency) || bounds.maxConcurrency
    );
    const initialConcurrency = Math.max(
      minConcurrency,
      Math.min(
        maxConcurrency,
        normalizePositiveInt(config.initialConcurrency, bounds.initialConcurrency)
          || bounds.initialConcurrency
      )
    );
    adaptiveSurfaceStates.set(surfaceName, {
      name: surfaceName,
      minConcurrency,
      maxConcurrency,
      currentConcurrency: initialConcurrency,
      upBacklogPerSlot: normalizeBacklogRatio(
        config.upBacklogPerSlot,
        defaults.upBacklogPerSlot,
        0.1
      ),
      downBacklogPerSlot: normalizeBacklogRatio(
        config.downBacklogPerSlot,
        defaults.downBacklogPerSlot,
        0
      ),
      upWaitMs: normalizeCooldownMs(config.upWaitMs, defaults.upWaitMs),
      downWaitMs: normalizeCooldownMs(config.downWaitMs, defaults.downWaitMs),
      upCooldownMs: normalizeCooldownMs(config.upCooldownMs, defaults.upCooldownMs),
      downCooldownMs: normalizeCooldownMs(config.downCooldownMs, defaults.downCooldownMs),
      oscillationGuardMs: normalizeCooldownMs(
        config.oscillationGuardMs,
        defaults.oscillationGuardMs
      ),
      targetUtilization: coerceUnitFraction(config.targetUtilization)
        ?? defaults.targetUtilization,
      ioPressureThreshold: normalizeRatio(
        config.ioPressureThreshold,
        defaults.ioPressureThreshold,
        { min: 0, max: 1 }
      ),
      memoryPressureThreshold: normalizeRatio(
        config.memoryPressureThreshold,
        defaults.memoryPressureThreshold,
        { min: 0, max: 1 }
      ),
      gcPressureThreshold: normalizeRatio(
        config.gcPressureThreshold,
        defaults.gcPressureThreshold,
        { min: 0, max: 1 }
      ),
      lastScaleUpAt: Number.NEGATIVE_INFINITY,
      lastScaleDownAt: Number.NEGATIVE_INFINITY,
      lastDecisionAt: 0,
      lastAction: 'hold',
      decisions: {
        up: 0,
        down: 0,
        hold: 0
      },
      lastDecision: null
    });
  }
  const resolveQueueSurface = (queueName, explicitSurface = null) => {
    const explicit = normalizeSurfaceName(explicitSurface);
    if (explicit && adaptiveSurfaceStates.has(explicit)) return explicit;
    const mapped = normalizeSurfaceName(surfaceQueueMap.get(queueName));
    if (mapped && adaptiveSurfaceStates.has(mapped)) return mapped;
    return null;
  };
  return {
    adaptiveSurfaceControllersEnabled,
    adaptiveSurfaceStates,
    resolveQueueSurface,
    adaptiveDecisionTrace,
    appendAdaptiveDecision,
    nextAdaptiveDecisionId
  };
};
