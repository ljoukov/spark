import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{
		ignores: ['node_modules', 'dist']
	},
	js.configs.recommended,
	...tseslint.configs.recommendedTypeChecked,
	{
		files: ['src/**/*.ts', 'tests/**/*.ts'],
		languageOptions: {
			parserOptions: {
				project: ['./tsconfig.json'],
				tsconfigRootDir: new URL('.', import.meta.url).pathname
			}
		},
		rules: {
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/restrict-template-expressions': 'off',
			'@typescript-eslint/unbound-method': 'off',
			'@typescript-eslint/only-throw-error': 'off',
			'@typescript-eslint/no-deprecated': 'error'
		}
	}
);
