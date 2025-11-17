import js from '@eslint/js';
import globals from 'globals';
import eslintPluginImport from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';

export default [
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
        ignores: [
            'node_modules',
            '!.*',
            '**/dist',
            '**/build',
            '**/scripts',
            '**/migrations',
            '**/seeders',
            '**/workers',
            "eslint.config.mjs"
        ],
    },
    {
        files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
        plugins: {
            import: eslintPluginImport,
            '@stylistic': stylistic,
        },
        languageOptions: {
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
                project: ['./tsconfig.json'],
            },
            globals: globals.node
        },
        settings: {
            'import/resolver': {
                node: true,
            },
        },
        rules: {
            // stylistic rules
            '@stylistic/array-bracket-spacing': ['error', 'never'],
            '@stylistic/block-spacing': ['error', 'always'],
            '@stylistic/comma-spacing': ['error', {before: false, after: true}],
            '@stylistic/computed-property-spacing': ['error', 'never'],
            '@stylistic/indent': ['error', 2],
            '@stylistic/key-spacing': ['error', {beforeColon: false, afterColon: true}],
            '@stylistic/keyword-spacing': ['error', {before: true, after: true}],
            '@stylistic/no-multi-spaces': 'error',
            '@stylistic/no-multiple-empty-lines': [2, {max: 2}],
            '@stylistic/object-curly-spacing': ['error', 'always'],
            '@stylistic/quotes': ['error', 'single', {allowTemplateLiterals: 'always'}],
            '@stylistic/semi': [2, 'always'],
            '@stylistic/semi-spacing': ['error', {before: false, after: true}],
            '@stylistic/space-before-blocks': ['error', 'always'],
            '@stylistic/space-before-function-paren': 0,
            '@stylistic/space-in-parens': ['error', 'never'],
            '@stylistic/space-infix-ops': 'error',
            '@stylistic/type-annotation-spacing': ['error', {before: false, after: true}],

            // import rules
            'import/no-unresolved': 0,
            'import/order': [
                'warn',
                {
                    groups: [
                        'builtin',
                        'external',
                        'internal',
                        'parent',
                        'sibling',
                        'index',
                        'type',
                        'object',
                    ],
                    'newlines-between': 'always',
                },
            ],

            // override typescript-eslint strict rules
            '@typescript-eslint/explicit-module-boundary-types': 'off',
            '@typescript-eslint/no-namespace': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off',
            '@typescript-eslint/no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
            }],

            //
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unsafe-return': 'off'
        },
    },
];
