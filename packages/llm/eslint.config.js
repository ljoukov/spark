import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{
		ignores: ['dist', 'node_modules']
	},
	js.configs.recommended,
	...tseslint.configs.recommendedTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				project: ['./tsconfig.json'],
				tsconfigRootDir: new URL('.', import.meta.url).pathname
			}
		},
		files: ['src/**/*.ts', 'tests/**/*.ts', 'llm-integration/**/*.ts'],
		rules: {
			'@typescript-eslint/no-deprecated': 'error'
		}
	}
);
