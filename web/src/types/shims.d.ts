declare module '@spark/llm/utils/gemini' {
	type ConfigureGeminiOptions = {
		projectId?: string;
		location?: string;
	};
	export function configureGemini(options?: ConfigureGeminiOptions): void;
}
