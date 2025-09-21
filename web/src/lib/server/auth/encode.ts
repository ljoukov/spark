import { base64decode, base64encode } from '$lib/utils/base64';
import { UserAuthProto } from '$proto/AuthProto';
import { decodeBytes, encodeBytes } from '$lib/server/utils/encoding';
import { isValidUserAuth, type UserAuth } from './auth';

export async function encodeUserAuth(userAuth: UserAuth): Promise<string> {
	const bytes = await encodeBytes(UserAuthProto.toBinary(userAuth));
	return base64encode(bytes);
}

export async function decodeUserAuth(dataString: string): Promise<UserAuth> {
	const data = await decodeBytes(base64decode(dataString));
	const userAuth = UserAuthProto.fromBinary(data);
	if (!isValidUserAuth(userAuth)) {
		throw Error('Invalid UserAuth value');
	}
	return userAuth;
}
