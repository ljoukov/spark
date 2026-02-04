import type { PageServerLoad } from './$types';
import { voices } from '@spark/llm';

export const load: PageServerLoad = async () => {
	return {
		voices: [...voices]
	};
};

