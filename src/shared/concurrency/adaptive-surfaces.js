export const ADAPTIVE_SURFACE_KEYS = Object.freeze([
  'parse',
  'inference',
  'artifactWrite',
  'sqlite',
  'embeddings'
]);

export const DEFAULT_ADAPTIVE_SURFACE_QUEUE_MAP = Object.freeze({
  'stage1.cpu': 'parse',
  // Intentionally not mapped:
  // stage1.io can be awaited from within stage1.cpu tasks.
  // stage1.postings can also run nested/blocked behind stage1.cpu progress.
  // stage1.proc can be awaited from within stage1.cpu tasks.
  // Sharing the same adaptive surface cap can deadlock nested scheduling.
  'stage2.relations': 'inference',
  'stage2.relations.io': 'inference',
  'stage2.write': 'artifactWrite',
  'stage4.sqlite': 'sqlite',
  'embeddings.compute': 'embeddings',
  'embeddings.io': 'embeddings'
});

export const DEFAULT_ADAPTIVE_SURFACE_POLICY = Object.freeze({
  parse: Object.freeze({
    targetUtilization: 0.88,
    upBacklogPerSlot: 1.2,
    downBacklogPerSlot: 0.35,
    upWaitMs: 1200,
    downWaitMs: 120,
    upCooldownMs: 500,
    downCooldownMs: 1400,
    oscillationGuardMs: 1200,
    ioPressureThreshold: 0.95,
    memoryPressureThreshold: 0.92,
    gcPressureThreshold: 0.35
  }),
  inference: Object.freeze({
    targetUtilization: 0.84,
    upBacklogPerSlot: 1.3,
    downBacklogPerSlot: 0.3,
    upWaitMs: 1500,
    downWaitMs: 160,
    upCooldownMs: 600,
    downCooldownMs: 1500,
    oscillationGuardMs: 1300,
    ioPressureThreshold: 0.9,
    memoryPressureThreshold: 0.9,
    gcPressureThreshold: 0.3
  }),
  artifactWrite: Object.freeze({
    targetUtilization: 0.76,
    upBacklogPerSlot: 1.4,
    downBacklogPerSlot: 0.25,
    upWaitMs: 1800,
    downWaitMs: 220,
    upCooldownMs: 700,
    downCooldownMs: 1800,
    oscillationGuardMs: 1500,
    ioPressureThreshold: 0.72,
    memoryPressureThreshold: 0.88,
    gcPressureThreshold: 0.25
  }),
  sqlite: Object.freeze({
    targetUtilization: 0.74,
    upBacklogPerSlot: 1.15,
    downBacklogPerSlot: 0.2,
    upWaitMs: 1000,
    downWaitMs: 100,
    upCooldownMs: 500,
    downCooldownMs: 1700,
    oscillationGuardMs: 1400,
    ioPressureThreshold: 0.75,
    memoryPressureThreshold: 0.87,
    gcPressureThreshold: 0.25
  }),
  embeddings: Object.freeze({
    targetUtilization: 0.8,
    upBacklogPerSlot: 1.35,
    downBacklogPerSlot: 0.3,
    upWaitMs: 1600,
    downWaitMs: 180,
    upCooldownMs: 650,
    downCooldownMs: 1600,
    oscillationGuardMs: 1350,
    ioPressureThreshold: 0.8,
    memoryPressureThreshold: 0.9,
    gcPressureThreshold: 0.3
  })
});
