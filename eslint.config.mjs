import js from '@eslint/js';
import globals from 'globals';

export default [
	{
		files: ['**/*.{js,mjs,cjs}'],
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
];
