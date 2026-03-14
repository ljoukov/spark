export type AnnotatedTextTheme = 'light' | 'dark';

export type AnnotatedTextAnnotation = {
	id: string;
	start: number;
	end: number;
	type: string;
	label: string;
	comment: string;
};

export type AnnotatedTextTypeMeta = {
	label?: string;
	lightColor: string;
	lightBackground: string;
	lightBorderColor: string;
	darkColor: string;
	darkBackground: string;
	darkBorderColor: string;
};

export type AnnotatedTextDocument = {
	heading: string;
	description: string;
	text: string;
	annotations: AnnotatedTextAnnotation[];
	annotationTypes: Record<string, AnnotatedTextTypeMeta>;
};
