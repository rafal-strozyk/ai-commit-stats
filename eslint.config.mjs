import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
	{
		ignores: ['dist/**', 'node_modules/**'],
	},
	{
		files: ['**/*.{js,mjs,cjs}', 'packages/**/*.ts'],
		...js.configs.recommended,
		languageOptions: {
			globals: globals.node,
		},
		rules: {
			...js.configs.recommended.rules,
			curly: ['error', 'all'],
			'brace-style': ['error', '1tbs', {
				allowSingleLine: false
			}],
			indent: ['error', 'tab'],
			'object-curly-newline': ['error', {
				ObjectExpression: {
					minProperties: 1
				},
			}],
			'object-property-newline': ['error', {
				allowAllPropertiesOnSameLine: false
			}],
			'padding-line-between-statements': ['error',
				{
					blankLine: 'always',
					prev: '*',
					next: 'block-like'
				},
				{
					blankLine: 'always',
					prev: 'block-like',
					next: '*'
				},
				{
					blankLine: 'always',
					prev: '*',
					next: 'return'
				},
			],
		},
	},
	...tseslint.configs.recommended.map(config => ({
		...config,
		files: ['packages/**/*.ts'],
	})),
];
