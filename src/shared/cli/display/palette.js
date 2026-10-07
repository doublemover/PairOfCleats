import {
  PALETTE,
  buildShadeScale,
  clampBackgroundColor,
  extractExtension,
  hashUnit,
  paletteColorAt,
  scaleColor,
  shiftHue
} from './colors.js';
import { resolveBarVariant } from './progress.js';

const PALETTE_SCHEMES = [
  { name: 'forward', stepFactor: 0.9, mode: 'linear', direction: 1 },
  { name: 'reverse', stepFactor: 0.9, mode: 'linear', direction: -1 },
  { name: 'drift', stepFactor: 1.05, mode: 'linear', direction: 1 },
  { name: 'pulse', stepFactor: 0.95, mode: 'triangle', span: Math.min(10, PALETTE.length - 1) }
];

const normalizeSlot = (slot) => {
  const span = PALETTE.length - 1;
  if (span <= 0) return 0;
  return ((slot % span) + span) % span;
};

const resolveHueShiftForTask = (state, task, variant) => {
  const extra = task?.extra && typeof task.extra === 'object' ? task.extra : {};
  const langHint = extra.languageId || extra.language || extra.lang || extra.extension || '';
  const messageExt = extractExtension(task?.message || '');
  const typeHint = langHint || messageExt;
  const key = `${task?.mode || ''}:${variant || ''}:${typeHint || ''}:${task?.name || ''}`;
  if (!state.hueShiftByTask.has(key)) {
    const unit = hashUnit(key);
    state.hueShiftByTask.set(key, (unit - 0.5) * 30);
  }
  return state.hueShiftByTask.get(key) || 0;
};

const resolveSlotForIndex = ({ state, paletteOffset, paletteStep, index }) => {
  const scheme = state.paletteScheme || PALETTE_SCHEMES[0];
  if (scheme.mode === 'triangle') {
    const span = Math.max(2, scheme.span || 6);
    const period = (span - 1) * 2;
    const pos = period > 0 ? index % period : 0;
    const wave = pos < span ? pos : period - pos;
    return normalizeSlot(paletteOffset + wave * paletteStep);
  }
  const direction = scheme.direction || 1;
  return normalizeSlot(paletteOffset + direction * index * paletteStep);
};

const resolvePaletteState = ({ state, taskCount }) => {
  if (!state.paletteScheme) {
    state.paletteScheme = PALETTE_SCHEMES[Math.floor(Math.random() * PALETTE_SCHEMES.length)];
  }
  const paletteSpan = Math.max(1, taskCount - 1);
  if (!Number.isFinite(state.paletteStep)) {
    const baseStep = Math.min(0.9, (PALETTE.length - 1) / paletteSpan);
    state.paletteStep = baseStep * (state.paletteScheme.stepFactor || 1);
  }
  const paletteStep = state.paletteStep || 0.7;
  const maxOffset = Math.max(0, (PALETTE.length - 1) - paletteStep * paletteSpan);
  if (!Number.isFinite(state.paletteOffset)) {
    state.paletteOffset = maxOffset > 0 ? Math.random() * maxOffset : 0;
  } else if (state.paletteOffset > maxOffset) {
    state.paletteOffset = maxOffset;
  }
  return {
    paletteOffset: state.paletteOffset || 0,
    paletteStep
  };
};

const assignPaletteSlots = ({ state, displayTasks, paletteOffset, paletteStep }) => {
  for (const task of displayTasks) {
    if (state.paletteSlots.has(task.id)) continue;
    const index = state.paletteOrder.length;
    const slot = resolveSlotForIndex({ state, paletteOffset, paletteStep, index });
    state.paletteSlots.set(task.id, slot);
    state.paletteOrder.push(task.id);
  }
};

export const resolveDisplayPalette = ({ state, displayTasks, tasksByMode }) => {
  const { paletteOffset, paletteStep } = resolvePaletteState({
    state,
    taskCount: displayTasks.length
  });
  assignPaletteSlots({ state, displayTasks, paletteOffset, paletteStep });

  const taskColors = new Map();
  const taskAccents = new Map();
  const taskShades = new Map();
  displayTasks.forEach((task) => {
    const slot = state.paletteSlots.get(task.id) ?? paletteOffset;
    const baseRaw = paletteColorAt(slot);
    const accentRaw = paletteColorAt(Math.min(PALETTE.length - 1, slot + 0.9));
    const variant = resolveBarVariant(task);
    const hueShift = resolveHueShiftForTask(state, task, variant);
    const base = clampBackgroundColor(shiftHue(baseRaw, hueShift), 0.5);
    const accent = clampBackgroundColor(shiftHue(accentRaw, hueShift), 0.5);
    taskColors.set(task.id, base);
    taskAccents.set(task.id, accent);
    taskShades.set(task.id, buildShadeScale(base));
  });

  const resolveBackgroundColor = (task, variant) => {
    if (!task?.mode) return null;
    if (variant === 'imports') {
      const stageTask = tasksByMode.stage.get(task.mode);
      if (stageTask) {
        const base = taskColors.get(stageTask.id) || null;
        return base ? scaleColor(base, 0.28) : null;
      }
    }
    if (variant === 'files') {
      const importsTask = tasksByMode.imports.get(task.mode);
      if (importsTask) {
        const base = taskColors.get(importsTask.id) || null;
        return base ? scaleColor(base, 0.28) : null;
      }
    }
    return null;
  };

  return {
    paletteOffset,
    paletteStep,
    taskColors,
    taskAccents,
    taskShades,
    resolveBackgroundColor
  };
};

export const resolveTaskShades = (taskShades, taskId, baseColor) => (
  taskShades.get(taskId) || buildShadeScale(baseColor)
);
