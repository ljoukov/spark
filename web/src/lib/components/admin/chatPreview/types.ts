import type { SparkAgentRunCard } from '@spark/schemas';
import type { TaskCardPreview } from '$lib/components/spark/chat/taskCardPreview';

export type ChatPreviewAttachment = {
	id: string;
	kind: 'image' | 'file';
	name: string;
	detail: string;
};

export type ChatPreviewRunCard = {
	runCard: SparkAgentRunCard;
	preview: TaskCardPreview;
};

export type ChatPreviewMessage = {
	id: string;
	role: 'user' | 'assistant';
	text?: string;
	thinkingText?: string;
	attachments?: ChatPreviewAttachment[];
	runCards?: ChatPreviewRunCard[];
	placeholder?: 'connecting' | 'sending' | 'thinking';
};

export type ChatPreviewScenario = {
	id: string;
	title: string;
	description: string;
	messages: ChatPreviewMessage[];
};
