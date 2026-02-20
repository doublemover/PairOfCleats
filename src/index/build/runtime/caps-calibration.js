import { LANGUAGE_ROUTE_DESCRIPTORS } from '../../language-registry/descriptors.js';

export const CAPS_CALIBRATION_SCHEMA_VERSION = 'caps-calibration-v1';

const ROUTE_BASELINES = Object.freeze({
  'tree-sitter-js': Object.freeze({ maxBytes: 320 * 1024, maxLines: 5000, maxParseMs: 1500 }),
  'tree-sitter-ts': Object.freeze({ maxBytes: 320 * 1024, maxLines: 5000, maxParseMs: 1500 }),
  'python-ast-tree-sitter': Object.freeze({ maxBytes: 384 * 1024, maxLines: 6000, maxParseMs: 1800 }),
  'tree-sitter-clike': Object.freeze({ maxBytes: 640 * 1024, maxLines: 10000, maxParseMs: 2600 }),
  'tree-sitter-go': Object.freeze({ maxBytes: 384 * 1024, maxLines: 6000, maxParseMs: 1500 }),
  'tree-sitter-java': Object.freeze({ maxBytes: 448 * 1024, maxLines: 7000, maxParseMs: 1900 }),
  'tree-sitter-c-sharp': Object.freeze({ maxBytes: 448 * 1024, maxLines: 7000, maxParseMs: 1900 }),
  'tree-sitter-kotlin': Object.freeze({ maxBytes: 384 * 1024, maxLines: 6500, maxParseMs: 1800 }),
  'tree-sitter-ruby': Object.freeze({ maxBytes: 320 * 1024, maxLines: 5000, maxParseMs: 1500 }),
  'tree-sitter-php': Object.freeze({ maxBytes: 384 * 1024, maxLines: 6000, maxParseMs: 1700 }),
  'tree-sitter-html': Object.freeze({ maxBytes: 256 * 1024, maxLines: 4000, maxParseMs: 1400 }),
  'tree-sitter-css': Object.freeze({ maxBytes: 256 * 1024, maxLines: 4500, maxParseMs: 1400 }),
  'tree-sitter-lua': Object.freeze({ maxBytes: 256 * 1024, maxLines: 4500, maxParseMs: 1400 }),
  'tree-sitter-sql': Object.freeze({ maxBytes: 320 * 1024, maxLines: 5000, maxParseMs: 1500 }),
  'tree-sitter-perl': Object.freeze({ maxBytes: 320 * 1024, maxLines: 5000, maxParseMs: 1500 }),
  'tree-sitter-shell': Object.freeze({ maxBytes: 256 * 1024, maxLines: 4000, maxParseMs: 1300 }),
  'tree-sitter-rust': Object.freeze({ maxBytes: 384 * 1024, maxLines: 6000, maxParseMs: 1700 }),
  'tree-sitter-swift': Object.freeze({ maxBytes: 448 * 1024, maxLines: 7000, maxParseMs: 2000 }),
  'tree-sitter-cmake': Object.freeze({ maxBytes: 320 * 1024, maxLines: 5000, maxParseMs: 1500 }),
  'tree-sitter-starlark': Object.freeze({ maxBytes: 384 * 1024, maxLines: 6000, maxParseMs: 1700 }),
  'tree-sitter-nix': Object.freeze({ maxBytes: 320 * 1024, maxLines: 5000, maxParseMs: 1500 }),
  'tree-sitter-dart': Object.freeze({ maxBytes: 384 * 1024, maxLines: 6500, maxParseMs: 1800 }),
  'tree-sitter-scala': Object.freeze({ maxBytes: 448 * 1024, maxLines: 7000, maxParseMs: 1900 }),
  'tree-sitter-groovy': Object.freeze({ maxBytes: 384 * 1024, maxLines: 6000, maxParseMs: 1700 }),
  'tree-sitter-r': Object.freeze({ maxBytes: 320 * 1024, maxLines: 5500, maxParseMs: 1600 }),
  'tree-sitter-julia': Object.freeze({ maxBytes: 384 * 1024, maxLines: 6000, maxParseMs: 1700 }),
  'tree-sitter-handlebars': Object.freeze({ maxBytes: 192 * 1024, maxLines: 3000, maxParseMs: 1100 }),
  'tree-sitter-mustache': Object.freeze({ maxBytes: 192 * 1024, maxLines: 3000, maxParseMs: 1100 }),
  'tree-sitter-jinja': Object.freeze({ maxBytes: 224 * 1024, maxLines: 3500, maxParseMs: 1200 }),
  'tree-sitter-razor': Object.freeze({ maxBytes: 224 * 1024, maxLines: 3500, maxParseMs: 1200 }),
  'tree-sitter-proto': Object.freeze({ maxBytes: 256 * 1024, maxLines: 4000, maxParseMs: 1300 }),
  'line-parser-makefile': Object.freeze({ maxBytes: 320 * 1024, maxLines: 5500, maxParseMs: 1200 }),
  'line-parser-dockerfile': Object.freeze({ maxBytes: 288 * 1024, maxLines: 4500, maxParseMs: 1200 }),
  'tree-sitter-graphql': Object.freeze({ maxBytes: 224 * 1024, maxLines: 3500, maxParseMs: 1200 }),
  'structured-ini': Object.freeze({ maxBytes: 192 * 1024, maxLines: 3000, maxParseMs: 900 }),
  'structured-json': Object.freeze({ maxBytes: 256 * 1024, maxLines: 4000, maxParseMs: 1000 }),
  'structured-toml': Object.freeze({ maxBytes: 224 * 1024, maxLines: 3500, maxParseMs: 900 }),
  'structured-xml': Object.freeze({ maxBytes: 256 * 1024, maxLines: 4000, maxParseMs: 1200 }),
  'structured-yaml': Object.freeze({ maxBytes: 224 * 1024, maxLines: 3500, maxParseMs: 1100 })
});

const DEFAULT_BASELINE = Object.freeze({ maxBytes: 256 * 1024, maxLines: 4000, maxParseMs: 1200 });

const LANGUAGE_BASELINE_OVERRIDES = Object.freeze({
  clike: Object.freeze({ maxBytes: 640 * 1024, maxLines: 10000, maxParseMs: 2600 }),
  cmake: Object.freeze({ maxBytes: 320 * 1024, maxLines: 5000, maxParseMs: 1500 }),
  javascript: Object.freeze({ maxBytes: 320 * 1024, maxLines: 5000, maxParseMs: 1500 }),
  dockerfile: Object.freeze({ maxBytes: 288 * 1024, maxLines: 4500, maxParseMs: 1200 }),
  dart: Object.freeze({ maxBytes: 384 * 1024, maxLines: 6500, maxParseMs: 1800 }),
  makefile: Object.freeze({ maxBytes: 320 * 1024, maxLines: 5500, maxParseMs: 1200 }),
  nix: Object.freeze({ maxBytes: 320 * 1024, maxLines: 5000, maxParseMs: 1500 }),
  groovy: Object.freeze({ maxBytes: 384 * 1024, maxLines: 6000, maxParseMs: 1700 }),
  julia: Object.freeze({ maxBytes: 384 * 1024, maxLines: 6000, maxParseMs: 1700 }),
  r: Object.freeze({ maxBytes: 320 * 1024, maxLines: 5500, maxParseMs: 1600 }),
  scala: Object.freeze({ maxBytes: 448 * 1024, maxLines: 7000, maxParseMs: 1900 }),
  starlark: Object.freeze({ maxBytes: 384 * 1024, maxLines: 6000, maxParseMs: 1700 }),
  typescript: Object.freeze({ maxBytes: 320 * 1024, maxLines: 5000, maxParseMs: 1500 }),
  yaml: Object.freeze({ maxBytes: 224 * 1024, maxLines: 3500, maxParseMs: 1100 }),
  xml: Object.freeze({ maxBytes: 256 * 1024, maxLines: 4000, maxParseMs: 1200 })
});

const buildLanguageBaseline = (descriptor) => {
  const routeBaseline = ROUTE_BASELINES[descriptor.parserRoute] || DEFAULT_BASELINE;
  const override = LANGUAGE_BASELINE_OVERRIDES[descriptor.id] || null;
  return {
    maxBytes: override?.maxBytes || routeBaseline.maxBytes,
    maxLines: override?.maxLines || routeBaseline.maxLines,
    maxParseMs: override?.maxParseMs || routeBaseline.maxParseMs
  };
};

const buildTelemetryBaseline = ({ maxBytes, maxLines, maxParseMs }) => ({
  bytes: {
    p50: Math.floor(maxBytes * 0.25),
    p95: Math.floor(maxBytes * 0.75),
    p99: Math.floor(maxBytes * 0.95)
  },
  lines: {
    p50: Math.floor(maxLines * 0.25),
    p95: Math.floor(maxLines * 0.75),
    p99: Math.floor(maxLines * 0.95)
  },
  tokens: {
    p50: Math.floor(maxLines * 2.5),
    p95: Math.floor(maxLines * 7.5),
    p99: Math.floor(maxLines * 10)
  },
  chunks: {
    p50: 4,
    p95: 18,
    p99: 28
  },
  parseMs: {
    p50: Math.max(30, Math.floor(maxParseMs * 0.15)),
    p95: Math.max(90, Math.floor(maxParseMs * 0.65)),
    p99: maxParseMs
  }
});

const entries = LANGUAGE_ROUTE_DESCRIPTORS
  .map((descriptor) => {
    const baseline = buildLanguageBaseline(descriptor);
    return {
      id: descriptor.id,
      parserRoute: descriptor.parserRoute,
      capsProfile: descriptor.capsProfile,
      ...baseline,
      telemetry: buildTelemetryBaseline(baseline)
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

export const LANGUAGE_CAPS_BASELINES = Object.freeze(
  Object.fromEntries(entries.map((entry) => [entry.id, Object.freeze({
    maxBytes: entry.maxBytes,
    maxLines: entry.maxLines
  })]))
);

export const TREE_SITTER_CAPS_BASELINES = Object.freeze(
  Object.fromEntries(entries.map((entry) => [entry.id, Object.freeze({
    maxBytes: entry.maxBytes,
    maxLines: entry.maxLines,
    maxParseMs: entry.maxParseMs
  })]))
);

export const LANGUAGE_TELEMETRY_BASELINES = Object.freeze(
  Object.fromEntries(entries.map((entry) => [entry.id, Object.freeze(entry.telemetry)]))
);

export const buildCapsCalibrationArtifacts = () => ({
  schemaVersion: CAPS_CALIBRATION_SCHEMA_VERSION,
  generatedAt: '2026-02-20T23:10:00Z',
  inputs: {
    source: 'deterministic-language-baseline',
    languages: entries.map((entry) => ({
      id: entry.id,
      parserRoute: entry.parserRoute,
      capsProfile: entry.capsProfile,
      telemetry: entry.telemetry
    }))
  },
  results: {
    fileCapsByLanguage: Object.fromEntries(entries.map((entry) => [entry.id, {
      maxBytes: entry.maxBytes,
      maxLines: entry.maxLines
    }])),
    treeSitterByLanguage: Object.fromEntries(entries.map((entry) => [entry.id, {
      maxBytes: entry.maxBytes,
      maxLines: entry.maxLines,
      maxParseMs: entry.maxParseMs
    }]))
  }
});
