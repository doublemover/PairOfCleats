export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/index-*/**',
      '**/index-sqlite/**',
      'benchmarks/repos/**',
      'benchmarks/cache/**',
      'benchmarks/results/**',
      'tests/.cache/**',
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
    rules: {}
  }
];
