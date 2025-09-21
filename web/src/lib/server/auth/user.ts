import { GOOGLE_API_KEY } from '$env/static/private';
import { responseErrorAsString } from '$lib/utils/error';

export async function deleteAccount({ idToken }: { idToken: string }) {
	const response = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:delete', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-goog-api-key': GOOGLE_API_KEY
		},
		body: JSON.stringify({ idToken })
	});
	if (!response.ok) {
		const errorMessage = `Failed to delete account: ${await responseErrorAsString(response)}`;
		console.log('deleteAccount:', errorMessage);
		throw new Error(errorMessage);
	}
	const json = await response.json();
	console.log(`deleteAccount: ${JSON.stringify(json)}`);
}
