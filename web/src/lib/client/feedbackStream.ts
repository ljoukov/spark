const FEEDBACK_MARKER = '%FEEDBACK%:';
const FEEDBACK_MARKER_LOWER = FEEDBACK_MARKER.toLowerCase();

export type FeedbackStreamParser = {
	append: (delta: string) => string | null;
};

function trimLeadingWhitespace(value: string): string {
	return value.replace(/^[\s\r\n]+/, '');
}

export function createFeedbackStreamParser(): FeedbackStreamParser {
	let buffer = '';
	let feedback = '';
	let sawMarker = false;

	return {
		append(delta: string): string | null {
			if (!delta) {
				return null;
			}
			if (sawMarker) {
				feedback += delta;
				return feedback;
			}

			buffer += delta;
			const markerIndex = buffer.toLowerCase().indexOf(FEEDBACK_MARKER_LOWER);
			if (markerIndex === -1) {
				if (buffer.length > FEEDBACK_MARKER.length * 2) {
					buffer = buffer.slice(-FEEDBACK_MARKER.length);
				}
				return null;
			}

			sawMarker = true;
			const afterMarker = buffer.slice(markerIndex + FEEDBACK_MARKER.length);
			buffer = '';
			feedback += trimLeadingWhitespace(afterMarker);
			return feedback.length > 0 ? feedback : null;
		}
	};
}
