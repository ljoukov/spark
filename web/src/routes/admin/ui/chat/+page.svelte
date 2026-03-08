<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import ChatPreviewMessage from '$lib/components/admin/chatPreview/ChatPreviewMessage.svelte';
	import type { ChatPreviewAttachment, ChatPreviewScenario } from '$lib/components/admin/chatPreview/types';

	const uploadedWork: ChatPreviewAttachment[] = [
		{
			id: 'student-solution',
			kind: 'image',
			name: 'worked-solution.jpg',
			detail: 'Handwritten submission'
		},
		{
			id: 'problem-statement',
			kind: 'file',
			name: 'problem-statement.pdf',
			detail: 'Uploaded problem sheet'
		}
	];

	const graderRunCard = {
		kind: 'grader',
		runId: 'preview-hamilton-2024-p8',
		href: '/spark/grader/preview-hamilton-2024-p8',
		listHref: '/spark/grader',
		title: 'Hamilton Olympiad by UKMT',
		sourceAttachmentCount: 2
	} as const;

	const scenarios = [
		{
			id: 'grader-queued',
			title: 'Grader card appears immediately',
			description:
				'The assistant reply is already a run card as soon as `create_grader` succeeds, without relying on fallback markdown.',
			messages: [
				{
					id: 'queued-user',
					role: 'user',
					text: 'Grade this solution against the uploaded problem statement.',
					attachments: uploadedWork
				},
				{
					id: 'queued-assistant',
					role: 'assistant',
					runCards: [
						{
							runCard: graderRunCard,
							preview: {
								kind: 'grader',
								status: 'created',
								title: 'Hamilton Olympiad by UKMT',
								subtitle: 'Problem 8 • Uploaded-only references',
								meta: '2 uploads attached',
								summary: 'Preparing the grader workspace and attaching the uploaded documents.'
							}
						}
					]
				}
			]
		},
		{
			id: 'grader-running',
			title: 'Running grader with live status',
			description:
				'The same card stays in-thread while the background agent is executing, with an explicit status and spinner.',
			messages: [
				{
					id: 'running-user',
					role: 'user',
					text: 'Please mark part (a) and part (b), and point out any gaps in rigor.',
					attachments: uploadedWork
				},
				{
					id: 'running-assistant',
					role: 'assistant',
					runCards: [
						{
							runCard: graderRunCard,
							preview: {
								kind: 'grader',
								status: 'executing',
								title: 'Hamilton Olympiad 2024',
								subtitle: 'Problem 8 • Uploaded-only references',
								meta: '2 uploads attached',
								summary:
									'Grading uploaded documents, transcribing the student work, and compiling line-by-line feedback.'
							}
						}
					],
					text: 'I’m grading the uploaded work now. The run card above should stay live until the report is ready.'
				}
			]
		},
		{
			id: 'grader-ready',
			title: 'Completed grader run',
			description:
				'Once the run finishes, the same card flips into a ready state and can show totals directly in chat.',
			messages: [
				{
					id: 'ready-user',
					role: 'user',
					text: 'Grade this and tell me where the argument becomes invalid.',
					attachments: uploadedWork
				},
				{
					id: 'ready-assistant',
					role: 'assistant',
					runCards: [
						{
							runCard: graderRunCard,
							preview: {
								kind: 'grader',
								status: 'done',
								title: 'Hamilton Olympiad 2024',
								subtitle: 'Year 2024 • Hamilton Olympiad by UKMT',
								meta: '60% scored',
								summary:
									'6/10 marks across 2 problems, with the main loss coming from an unsupported step in part (b).',
								totals: {
									awardedMarks: 6,
									maxMarks: 10,
									problemCount: 2,
									percentage: 60
								}
							}
						}
					],
					text: 'The report is ready. Open the grader run for the full transcript and line-by-line annotations.'
				}
			]
		},
		{
			id: 'grader-failed',
			title: 'Failed grader run',
			description:
				'Failure should still render as a chat card so the user sees status and the direct link to inspect the run.',
			messages: [
				{
					id: 'failed-user',
					role: 'user',
					text: 'Try grading this upload anyway.',
					attachments: uploadedWork
				},
				{
					id: 'failed-assistant',
					role: 'assistant',
					runCards: [
						{
							runCard: graderRunCard,
							preview: {
								kind: 'grader',
								status: 'failed',
								title: 'Hamilton Olympiad by UKMT',
								subtitle: 'Problem 8 • Uploaded-only references',
								meta: '2 uploads attached',
								summary:
									'The grader could not extract a reliable transcript from one upload. Open the run for the failure details.'
							}
						}
					],
					text: 'The run failed before grading completed, but the chat still keeps the run card in place.'
				}
			]
		},
		{
			id: 'thinking-latex',
			title: 'Thinking block with LaTeX response',
			description:
				'Preview of the current assistant bubble treatment for streamed reasoning followed by Markdown with rendered math.',
			messages: [
				{
					id: 'latex-user',
					role: 'user',
					text: 'Show me a concise solution sketch for part (b).'
				},
				{
					id: 'latex-assistant',
					role: 'assistant',
					thinkingText: [
						'Need a short derivation, not a full report.',
						'Use the triangular-number identity first, then isolate the remainder term.'
					].join('\n\n'),
					text: [
						'Write the target number as',
						'',
						'\\[',
						'm = T_a + b = \\frac{a(a+1)}{2} + b, \\quad 0 \\le b \\le a.',
						'\\]',
						'',
						'Then the constructed sequence has length \\(a+1\\), and the sum is prime exactly when the remainder term survives the parity check.'
					].join('\n')
				}
			]
		},
		{
			id: 'markdown-table',
			title: 'Markdown table response',
			description:
				'Table rendering should be easy to inspect without waiting for a live model response.',
			messages: [
				{
					id: 'table-user',
					role: 'user',
					text: 'Summarise the grading outcome in a compact table.'
				},
				{
					id: 'table-assistant',
					role: 'assistant',
					text: [
						'| Part | Mark | Notes |',
						'| --- | ---: | --- |',
						'| (a) | 4/4 | Clear triangular-number setup and correct simplification. |',
						'| (b) | 2/6 | The conclusion jumps from \\(m=T_a+b\\) to primality without justifying the final case split. |',
						'',
						'Overall: strong setup, but part **(b)** needs a complete argument for the last implication.'
					].join('\n')
				}
			]
		}
	] satisfies ChatPreviewScenario[];
</script>

<div class="space-y-6">
	<div class="space-y-3">
		<div class="space-y-2">
			<h1 class="text-2xl font-semibold tracking-tight text-foreground">Chat UI previews</h1>
			<p class="max-w-3xl text-sm text-muted-foreground">
				Static chat transcripts for debugging the assistant renderer without launching real agent runs.
				These scenarios intentionally cover grader cards, streamed thinking, LaTeX, and Markdown
				tables.
			</p>
		</div>

		<div class="flex flex-wrap gap-2">
			<a
				href="/admin/ui"
				class={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
			>
				Back to UI previews
			</a>
			<a
				href="/admin/ui/spark-stream"
				class={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
			>
				Open stream-state preview
			</a>
		</div>
	</div>

	<div class="grid gap-5 xl:grid-cols-2">
		{#each scenarios as scenario (scenario.id)}
			<Card.Root class="border-border/70 bg-card/95 shadow-sm">
				<Card.Header class="space-y-1">
					<Card.Title>{scenario.title}</Card.Title>
					<Card.Description>{scenario.description}</Card.Description>
				</Card.Header>
				<Card.Content>
					<div class="chat-preview-shell">
						<div class="chat-preview-thread">
							{#each scenario.messages as message (message.id)}
								<ChatPreviewMessage {message} />
							{/each}
						</div>
					</div>
				</Card.Content>
			</Card.Root>
		{/each}
	</div>
</div>

<style lang="postcss">
	.chat-preview-shell {
		border-radius: 1.5rem;
		border: 1px solid color-mix(in srgb, var(--border) 74%, transparent);
		background:
			linear-gradient(180deg, color-mix(in srgb, var(--background) 88%, white 12%), color-mix(in srgb, var(--background) 96%, transparent)),
			radial-gradient(circle at top, color-mix(in srgb, var(--accent) 8%, transparent), transparent 52%);
		padding: 1rem;
	}

	.chat-preview-thread {
		display: flex;
		flex-direction: column;
		gap: 1.35rem;
		max-width: 46rem;
		margin: 0 auto;
	}
</style>
