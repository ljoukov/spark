import type { SparkAgentRunCard } from '@spark/schemas';
import type { AgentRunCardPreview } from '$lib/components/spark/chat/agentRunCardPreview';

export type ChatPreviewAttachment = {
	id: string;
	kind: 'image' | 'file';
	name: string;
	detail: string;
};

export type ChatPreviewRunCard = {
	runCard: SparkAgentRunCard;
	preview: AgentRunCardPreview;
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

