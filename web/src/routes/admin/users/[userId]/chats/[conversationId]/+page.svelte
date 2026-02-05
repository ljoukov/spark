<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { cn } from '$lib/utils.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const conversation = $derived(data.conversation);

	function formatInstant(value: string | null): string {
		if (!value) {
			return '—';
		}
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) {
			return value;
		}
		return date.toLocaleString();
	}

	function roleBadgeClass(role: string): string {
		if (role === 'user') {
			return 'bg-sky-100 text-sky-800 border-sky-200';
		}
		if (role === 'assistant') {
			return 'bg-emerald-100 text-emerald-800 border-emerald-200';
		}
		if (role === 'tool') {
			return 'bg-amber-100 text-amber-800 border-amber-200';
		}
		return 'bg-muted text-muted-foreground border-border';
	}

	function formatBytes(bytes: number): string {
		if (!Number.isFinite(bytes)) {
			return '—';
		}
		if (bytes < 1024) {
			return `${bytes} B`;
		}
		const kb = bytes / 1024;
		if (kb < 1024) {
			return `${kb.toFixed(1)} KB`;
		}
		const mb = kb / 1024;
		if (mb < 1024) {
			return `${mb.toFixed(1)} MB`;
		}
		const gb = mb / 1024;
		return `${gb.toFixed(1)} GB`;
	}

	function prettyJson(value: string): string {
		const trimmed = value.trim();
		if (!trimmed) {
			return '';
		}
		try {
			return JSON.stringify(JSON.parse(trimmed), null, 2);
		} catch {
			return value;
		}
	}
</script>

{#if !data.conversationDocFound}
	<p class="rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-destructive">
		Chat not found.
	</p>
{:else if !data.conversationParseOk}
	<p class="rounded-md border border-amber-300/80 bg-amber-50 px-3 py-2 text-sm text-amber-900">
		Chat document exists but could not be parsed. ({data.parseIssues.length} issue{data.parseIssues.length === 1 ? '' : 's'})
	</p>
{/if}

{#if data.parseIssues.length > 0}
	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>Parse issues</Card.Title>
		</Card.Header>
		<Card.Content class="space-y-2 text-sm">
			{#each data.parseIssues as issue (issue.path + issue.message)}
				<p class="font-mono text-xs text-muted-foreground">
					<span class="text-foreground">{issue.path || '(root)'}</span>: {issue.message}
				</p>
			{/each}
		</Card.Content>
	</Card.Root>
{/if}

{#if conversation}
	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>Chat</Card.Title>
			<Card.Description>Read-only view of the conversation.</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-3">
			<div class="grid gap-3 md:grid-cols-2">
				<div class="rounded-lg border border-border/70 bg-muted/20 p-3">
					<p class="text-xs text-muted-foreground">Conversation ID</p>
					<p class="mt-1 font-mono text-xs break-all">{conversation.id}</p>
				</div>
				<div class="rounded-lg border border-border/70 bg-muted/20 p-3">
					<p class="text-xs text-muted-foreground">Participants</p>
					<p class="mt-1 text-sm">{conversation.participantIds.join(', ')}</p>
				</div>
				<div class="rounded-lg border border-border/70 bg-muted/20 p-3">
					<p class="text-xs text-muted-foreground">Created</p>
					<p class="mt-1 text-sm">{formatInstant(conversation.createdAt)}</p>
				</div>
				<div class="rounded-lg border border-border/70 bg-muted/20 p-3">
					<p class="text-xs text-muted-foreground">Last message</p>
					<p class="mt-1 text-sm">{formatInstant(conversation.lastMessageAt)}</p>
				</div>
			</div>

			{#if conversation.attachments.length > 0}
				<div class="rounded-lg border border-border/70 bg-muted/10 p-3">
					<p class="text-xs font-semibold text-foreground">Attachments</p>
					<div class="mt-2 space-y-2">
						{#each conversation.attachments as attachment (attachment.id)}
							<div class="rounded-md border border-border/70 bg-background p-3">
								<div class="flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
									<div class="space-y-1">
										<p class="text-sm font-semibold text-foreground">
											{attachment.filename ?? attachment.id}
										</p>
										<p class="text-xs text-muted-foreground">
											{attachment.contentType} · {formatBytes(attachment.sizeBytes)} · {attachment.status}
										</p>
										<p class="text-xs text-muted-foreground">
											<span class="font-mono">{attachment.storagePath}</span>
										</p>
										{#if attachment.error}
											<p class="text-xs text-destructive">{attachment.error}</p>
										{/if}
									</div>
									{#if attachment.downloadUrl}
										<a
											href={attachment.downloadUrl}
											target="_blank"
											rel="noreferrer"
											class="text-xs text-primary underline"
										>
											Open
										</a>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root class="border-border/70 bg-card/95 shadow-sm">
		<Card.Header>
			<Card.Title>Messages</Card.Title>
			<Card.Description>{conversation.messages.length} total.</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-3">
			{#each conversation.messages as message (message.id)}
				<div class="rounded-xl border border-border/70 p-4">
					<div class="flex flex-wrap items-center gap-2">
						<span
							class={cn(
								'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
								roleBadgeClass(message.role)
							)}
						>
							{message.role}
						</span>
						<p class="text-xs text-muted-foreground">{formatInstant(message.createdAt)}</p>
						{#if message.author?.displayName}
							<p class="text-xs text-muted-foreground">· {message.author.displayName}</p>
						{/if}
					</div>

					<div class="mt-3 space-y-2">
						{#each message.content as part, idx (idx)}
							{#if part.type === 'text'}
								<p class="whitespace-pre-wrap text-sm text-foreground">{part.text}</p>
							{:else if part.type === 'image'}
								<div class="rounded-lg border border-border/70 bg-muted/10 p-3">
									<p class="text-xs font-semibold text-foreground">
										Image: {part.file.filename ?? part.file.storagePath}
									</p>
									<p class="text-xs text-muted-foreground">
										{part.file.contentType} · {formatBytes(part.file.sizeBytes)}
									</p>
									{#if part.file.downloadUrl}
										<a
											href={part.file.downloadUrl}
											target="_blank"
											rel="noreferrer"
											class="text-xs text-primary underline"
										>
											Open
										</a>
										<img
											src={part.file.downloadUrl}
											alt={part.file.filename ?? 'image'}
											class="mt-2 max-h-64 rounded-md border border-border/70 object-contain"
										/>
									{/if}
								</div>
							{:else if part.type === 'file'}
								<div class="rounded-lg border border-border/70 bg-muted/10 p-3">
									<p class="text-xs font-semibold text-foreground">
										File: {part.file.filename ?? part.file.storagePath}
									</p>
									<p class="text-xs text-muted-foreground">
										{part.file.contentType} · {formatBytes(part.file.sizeBytes)}
									</p>
									{#if part.file.downloadUrl}
										<a
											href={part.file.downloadUrl}
											target="_blank"
											rel="noreferrer"
											class="text-xs text-primary underline"
										>
											Open
										</a>
									{/if}
								</div>
							{:else if part.type === 'tool_call'}
								<div class="rounded-lg border border-border/70 bg-muted/10 p-3">
									<p class="text-xs font-semibold text-foreground">
										Tool call: {part.toolCall.name}
									</p>
									<pre class="mt-2 overflow-x-auto rounded-md bg-muted/40 p-3 text-xs text-foreground">{prettyJson(part.toolCall.argsJson)}</pre>
								</div>
							{:else if part.type === 'tool_result'}
								<div class="rounded-lg border border-border/70 bg-muted/10 p-3">
									<p class="text-xs font-semibold text-foreground">
										Tool result: {part.toolResult.status}
									</p>
									<pre class="mt-2 overflow-x-auto rounded-md bg-muted/40 p-3 text-xs text-foreground">{prettyJson(part.toolResult.outputJson)}</pre>
								</div>
							{/if}
						{/each}
					</div>
				</div>
			{/each}
		</Card.Content>
	</Card.Root>
{/if}

