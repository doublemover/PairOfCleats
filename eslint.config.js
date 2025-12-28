export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/index-*/**',
      '**/index-sqlite/**',
      '**/.git/**',
      '**/docs/phase3-parity-report.json'
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
