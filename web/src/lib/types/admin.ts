export type AdminUser = {
	uid: string;
	email: string | null;
	name: string | null;
	photoUrl: string | null;
};

export type AdminSessionState =
	| { status: 'signed_out' }
	| { status: 'not_admin'; user: AdminUser }
	| { status: 'admin'; user: AdminUser };
