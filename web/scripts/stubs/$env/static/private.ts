const key = process.env.GEMINI_API_KEY;

if (!key) {
	throw new Error(
		'GEMINI_API_KEY environment variable is required to run the sample preview generator.'
	);
}

export const GEMINI_API_KEY: string = key;
