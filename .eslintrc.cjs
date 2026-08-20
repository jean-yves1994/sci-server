module.exports = {
  root: true, parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended','plugin:@typescript-eslint/recommended','prettier'],
  env: { node: true, es2022: true, jest: true },
  ignorePatterns: ['dist','node_modules','*.js','*.cjs','*.mjs'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    'no-console': 'off',
  },
};
