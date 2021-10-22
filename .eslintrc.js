module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    parserOptions: { ecmaVersion: 2019, sourceType: 'module' },
    plugins: ['@typescript-eslint'],
    env: { browser: true, es6: true },
    extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'plugin:prettier/recommended'],
};
