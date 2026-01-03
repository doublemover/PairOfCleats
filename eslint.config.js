export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/index-*/**',
      '**/index-sqlite/**',
      'benchmarks/repos/**',
      'benchmarks/cache/**',
      'benchmarks/results/**',
      '**/.git/**',
      '**/docs/phase3-parity-report.json',
      'tests/fixtures/languages/src/javascript_flow.js'
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
