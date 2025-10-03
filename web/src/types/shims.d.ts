declare module '@spark/llm/utils/gemini' {
	type ConfigureGeminiOptions = Record<string, unknown>;
	export function configureGemini(options?: ConfigureGeminiOptions): void;
}
