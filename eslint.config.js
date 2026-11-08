import noRegexDoubleEscape from './eslint-rules/no-regex-double-escape.js';

// Keep unresolved runtime references out of executable owners. Fixture source
// deliberately contains unresolved names and remains outside this rule.
const sourceGlobals = Object.fromEntries(Object.getOwnPropertyNames(globalThis)
  .filter(name => /^[A-Za-z_$][\w$]*$/.test(name)).map(name => [name, 'readonly']));
const browserGlobals = Object.fromEntries([
  'Option', 'window', 'document', 'navigator', 'location', 'self', 'postMessage',
  'addEventListener', 'removeEventListener', 'requestAnimationFrame', 'cancelAnimationFrame',
  'ResizeObserver', 'MutationObserver', 'IntersectionObserver', 'HTMLElement', 'Element',
  'Node', 'Image', 'ImageData', 'CustomEvent', 'EventTarget', 'Worker', 'importScripts',
  'getComputedStyle', 'matchMedia', 'localStorage', 'sessionStorage', 'screen', 'devicePixelRatio',
  'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'DOMParser', 'XMLSerializer', 'FileReader',
  'WebSocket', 'alert', 'confirm', 'prompt', 'indexedDB'
].map(name => [name, 'readonly']));

export default [
  {
    ignores: [
      '**/node_modules/**',
      'index-*/**',
      '**/index-sqlite/**',
      'benchmarks/repos/**',
      'benchmarks/cache/**',
      'benchmarks/results/**',
      '.testCache/**',
      '.testLogs/**',
      'temp/**',
      '.tmp/**',
      'tests/.cache/**',
      '**/.worktrees/**',
      '**/worktrees/**',
      '**/.git/**',
      '**/docs/phase3-parity-report.json',
      'tests/fixtures/languages/src/javascript_flow.js',
      'tests/fixtures/encoding/latin1.js'
    ]
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    plugins: {
      local: {
        rules: {
          'no-regex-double-escape': noRegexDoubleEscape
        }
      }
    },
    rules: {
      'local/no-regex-double-escape': 'error',
      'max-lines': 'off',
      indent: ['error', 2, { SwitchCase: 1 }]
    }
  },
  {
    files: ['src/contracts/schemas/**/*.js'],
    rules: {
      'max-lines': 'off'
    }
  },
  {
    files: ['src/**/*.js', 'tools/**/*.js'],
    languageOptions: { globals: { ...sourceGlobals, ...browserGlobals } },
    rules: { 'no-undef': 'error' }
  }
];
