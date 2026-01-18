export const BLACK = { r: 0, g: 0, b: 0 };
export const STATUS_BRACKET_FG = { r: 238, g: 239, b: 241 };
export const CHECK_FG_OK = { r: 84, g: 196, b: 108 };
export const CHECK_FG_FAIL = { r: 220, g: 96, b: 96 };

export const clampChannel = (value) => Math.max(0, Math.min(255, Math.round(value)));

export const mixChannel = (from, to, t) => clampChannel(from + (to - from) * t);

export const mixColor = (from, to, t) => ({
  r: mixChannel(from.r, to.r, t),
  g: mixChannel(from.g, to.g, t),
  b: mixChannel(from.b, to.b, t)
});

export const scaleColor = (color, factor) => ({
  r: clampChannel(color.r * factor),
  g: clampChannel(color.g * factor),
  b: clampChannel(color.b * factor)
});

export const brightenColor = (color, factor) => scaleColor(color, 1 + factor);

export const lightenColor = (color, factor) => mixColor(color, { r: 255, g: 255, b: 255 }, factor);

const toLinear = (value) => {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

export const relativeLuminance = (color) => {
  const r = toLinear(color.r);
  const g = toLinear(color.g);
  const b = toLinear(color.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const clampBackgroundColor = (color, maxLuma = 0.45) => {
  const lum = relativeLuminance(color);
  if (lum <= maxLuma) return color;
  const factor = maxLuma / (lum || 1);
  return scaleColor(color, factor);
};

export const clampForegroundColor = (color, minLuma = 0.6, maxLuma = 0.85) => {
  let next = color;
  let lum = relativeLuminance(next);
  if (lum < minLuma) {
    const factor = Math.min(1, (minLuma - lum) / (1 - lum || 1));
    next = mixColor(next, { r: 255, g: 255, b: 255 }, factor);
    lum = relativeLuminance(next);
  }
  if (lum > maxLuma) {
    const factor = maxLuma / (lum || 1);
    next = scaleColor(next, factor);
  }
  return next;
};

export const makeTextForeground = (base, factor = 0.55) => (
  clampForegroundColor(lightenColor(base, factor), 0.62, 0.88)
);

export const makeBarForeground = (base, factor = 0.32) => (
  clampForegroundColor(brightenColor(base, factor), 0.25, 0.65)
);

export const buildShadeScale = (base) => {
  const dark = clampBackgroundColor(scaleColor(base, 0.42));
  const light = clampBackgroundColor(lightenColor(base, 0.32), 0.55);
  const shades = [];
  for (let i = 0; i <= 25; i += 1) {
    shades.push(clampBackgroundColor(mixColor(dark, light, i / 25), 0.55));
  }
  return shades;
};

const rgbToHsl = (color) => {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        h = ((g - b) / delta) % 6;
        break;
      case g:
        h = (b - r) / delta + 2;
        break;
      default:
        h = (r - g) / delta + 4;
        break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
};

const hslToRgb = (h, s, l) => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h >= 0 && h < 60) {
    r = c; g = x; b = 0;
  } else if (h < 120) {
    r = x; g = c; b = 0;
  } else if (h < 180) {
    r = 0; g = c; b = x;
  } else if (h < 240) {
    r = 0; g = x; b = c;
  } else if (h < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }
  return {
    r: clampChannel((r + m) * 255),
    g: clampChannel((g + m) * 255),
    b: clampChannel((b + m) * 255)
  };
};

export const shiftHue = (color, degrees) => {
  if (!Number.isFinite(degrees) || degrees === 0) return color;
  const { h, s, l } = rgbToHsl(color);
  const nextHue = (h + degrees + 360) % 360;
  return hslToRgb(nextHue, s, l);
};

const hashString = (value) => {
  let hash = 0;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
};

export const hashUnit = (value) => (hashString(value) % 1000) / 1000;

export const extractExtension = (value) => {
  if (!value) return '';
  const text = String(value);
  const base = text.split(/[\\/]/).pop();
  if (!base) return '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
};

export const colorToAnsi = (color, isBackground = false) => {
  const prefix = isBackground ? '48' : '38';
  return `${prefix};2;${color.r};${color.g};${color.b}`;
};

export const composeColor = (foreground, background) => {
  if (foreground && background) return `${foreground};${background}`;
  return foreground || background || '';
};

export const PALETTE = [
  { r: 41, g: 86, b: 70 },
  { r: 43, g: 95, b: 87 },
  { r: 44, g: 99, b: 104 },
  { r: 45, g: 93, b: 113 },
  { r: 46, g: 84, b: 122 },
  { r: 46, g: 71, b: 132 },
  { r: 47, g: 53, b: 142 },
  { r: 62, g: 47, b: 152 },
  { r: 88, g: 46, b: 162 },
  { r: 118, g: 46, b: 173 },
  { r: 154, g: 45, b: 184 },
  { r: 195, g: 44, b: 195 },
  { r: 207, g: 43, b: 172 },
  { r: 215, g: 45, b: 143 },
  { r: 220, g: 50, b: 111 },
  { r: 224, g: 56, b: 81 },
  { r: 228, g: 73, b: 62 },
  { r: 232, g: 115, b: 69 },
  { r: 236, g: 155, b: 75 },
  { r: 239, g: 193, b: 82 },
  { r: 242, g: 230, b: 89 },
  { r: 225, g: 245, b: 96 },
  { r: 197, g: 248, b: 104 },
  { r: 172, g: 250, b: 112 }
];

export const resolvePaletteSlot = (index, total, offset = 0, step = 1) => {
  if (!Number.isFinite(total) || total <= 1) return offset;
  return offset + index * step;
};

export const paletteColorAt = (slot) => {
  const clamped = Math.max(0, Math.min(PALETTE.length - 1, slot));
  const lower = Math.floor(clamped);
  const upper = Math.min(PALETTE.length - 1, lower + 1);
  const local = clamped - lower;
  return mixColor(PALETTE[lower], PALETTE[upper], local);
};

export const resolveGradientColor = (index, total, offset = 0, step = 1) => {
  const slot = resolvePaletteSlot(index, total, offset, step);
  return paletteColorAt(slot);
};
