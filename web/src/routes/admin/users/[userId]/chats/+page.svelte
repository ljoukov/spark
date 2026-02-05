<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const conversations = $derived(data.conversations);

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
</script>

<Card.Root class="border-border/70 bg-card/95 shadow-sm">
	<Card.Header>
		<Card.Title>Chats</Card.Title>
		<Card.Description>
			{#if conversations.length === 0}
				No chats found.
			{:else}
				Showing {conversations.length} chat{conversations.length === 1 ? '' : 's'}.
			{/if}
		</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-3">
		{#each conversations as convo (convo.id)}
			<div class="rounded-xl border border-border/70 p-4">
				<div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
					<div class="space-y-1">
						<a
							href={`/admin/users/${data.user.uid}/chats/${convo.id}`}
							class="text-sm font-semibold text-foreground hover:underline"
						>
							<span class="font-mono">{convo.id}</span>
						</a>
						<p class="text-xs text-muted-foreground">
							{convo.messageCount} message{convo.messageCount === 1 ? '' : 's'}
							{#if convo.preview}
								· {convo.preview}
							{/if}
						</p>
						<div class="grid gap-x-6 gap-y-1 text-xs text-muted-foreground md:grid-cols-2">
							<p>
								<span class="text-foreground/70">Created</span>
								<span class="ml-1">{formatInstant(convo.createdAt)}</span>
							</p>
							<p>
								<span class="text-foreground/70">Last message</span>
								<span class="ml-1">{formatInstant(convo.lastMessageAt)}</span>
							</p>
						</div>
					</div>

					<Button href={`/admin/users/${data.user.uid}/chats/${convo.id}`} variant="secondary" size="sm">
						View
					</Button>
				</div>
			</div>
		{/each}
	</Card.Content>
</Card.Root>

