<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { getContext, onDestroy } from 'svelte';
	import type { PageData } from './$types';

	type UserSnapshot = { name?: string | null; email?: string | null } | null;

	type UserStore = {
		subscribe: (run: (value: UserSnapshot) => void) => () => void;
	};

	let { data }: { data: PageData } = $props();

	const userStore = getContext<UserStore | undefined>('spark:user');

	function deriveGreeting(source: UserSnapshot, fallback = 'Spark friend'): string {
		const name = source?.name?.trim();
		if (name && name.length > 0) {
			return name.split(/\s+/)[0] ?? fallback;
		}
		const handle = source?.email?.split('@')[0]?.trim();
		if (handle && handle.length > 0) {
			return handle.split(/\s+/)[0] ?? fallback;
		}
		return fallback;
	}

	let firstName = $state(deriveGreeting(data.user ?? null));
	let isUploading = $state(false);
	let isDragging = $state(false);
	let uploadError = $state<string | null>(null);
	let uploadSuccess = $state<string | null>(null);
	let fileInput: HTMLInputElement | null = null;

	const MAX_FILE_BYTES = 25 * 1024 * 1024;
	const MAX_FILE_MB_LABEL = '25MB';
	const DEFAULT_QUIZ_QUESTION_COUNT = 20;

	function resetFeedback(): void {
		uploadError = null;
		uploadSuccess = null;
	}

	function isPdf(file: File): boolean {
		const lowerName = file.name?.toLowerCase() ?? '';
		if (lowerName.endsWith('.pdf')) {
			return true;
		}
		const type = file.type?.toLowerCase() ?? '';
		return type === 'application/pdf' || type === 'application/x-pdf';
	}

	async function uploadFile(file: File): Promise<void> {
		if (isUploading) {
			return;
		}

		resetFeedback();

		if (!isPdf(file)) {
			uploadError = 'Only PDF files are supported right now.';
			return;
		}

		if (file.size <= 0) {
			uploadError = 'The selected file appears to be empty.';
			return;
		}

		if (file.size > MAX_FILE_BYTES) {
			uploadError = `Files must be ${MAX_FILE_MB_LABEL} or smaller.`;
			return;
		}

		const formData = new FormData();
		formData.set('file', file);

		isUploading = true;
		try {
			const response = await fetch('/api/spark/upload', {
				method: 'POST',
				body: formData
			});
			let payload: unknown = null;
			try {
				payload = await response.json();
			} catch (parseError) {
				console.error('Spark upload: failed to parse response JSON', parseError);
			}

			if (!response.ok) {
				const message =
					payload && typeof payload === 'object' && payload !== null && 'message' in payload
						? String(
								(payload as { message?: unknown }).message ?? 'Upload failed. Please try again.'
							)
						: 'Upload failed. Please try again.';
				uploadError = message;
				return;
			}

			if (!payload || typeof payload !== 'object') {
				uploadSuccess = 'Upload completed.';
				return;
			}

			const payloadRecord = payload as Record<string, unknown>;
			const uploadDocPath =
				typeof payloadRecord.uploadDocPath === 'string' ? payloadRecord.uploadDocPath : null;
			const quizDocPath =
				typeof payloadRecord.quizDocPath === 'string' ? payloadRecord.quizDocPath : null;
			const questionCountRaw = payloadRecord.questionCount;
			let questionCount = DEFAULT_QUIZ_QUESTION_COUNT;
			if (
				typeof questionCountRaw === 'number' &&
				Number.isFinite(questionCountRaw) &&
				questionCountRaw > 0
			) {
				questionCount = Math.trunc(questionCountRaw);
			}

			if (uploadDocPath && quizDocPath) {
				uploadSuccess = `Upload saved. We'll build a ${questionCount}-question quiz next.`;
				return;
			}

			const storagePath =
				typeof payloadRecord.storagePath === 'string' ? payloadRecord.storagePath : null;
			if (storagePath) {
				uploadSuccess = `Uploaded to storage at ${storagePath}.`;
				return;
			}

			uploadSuccess = 'Upload completed.';
		} catch (error) {
			console.error('Spark upload: request failed', error);
			uploadError = 'We could not upload that file. Please check your connection and try again.';
		} finally {
			isUploading = false;
		}
	}

	function openFilePicker(): void {
		if (isUploading) {
			return;
		}
		fileInput?.click();
	}

	function handleButtonClick(event: MouseEvent): void {
		event.stopPropagation();
		openFilePicker();
	}

	function handleFileInputChange(event: Event & { currentTarget: HTMLInputElement }): void {
		const files = event.currentTarget.files;
		const file = files && files.length > 0 ? files[0] : null;
		if (file) {
			void uploadFile(file);
		}
		event.currentTarget.value = '';
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			openFilePicker();
		}
	}

	function handleDragOver(event: DragEvent): void {
		event.preventDefault();
		event.stopPropagation();
		if (isUploading) {
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = 'none';
			}
			return;
		}
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'copy';
		}
		if (!isDragging) {
			isDragging = true;
		}
	}

	function handleDragEnter(event: DragEvent): void {
		event.preventDefault();
		event.stopPropagation();
		if (isUploading) {
			return;
		}
		if (!isDragging) {
			isDragging = true;
		}
	}

	function handleDragLeave(event: DragEvent): void {
		event.preventDefault();
		event.stopPropagation();
		if (!(event.currentTarget instanceof HTMLElement)) {
			isDragging = false;
			return;
		}
		const nextTarget = event.relatedTarget;
		if (!nextTarget || !event.currentTarget.contains(nextTarget as Node)) {
			isDragging = false;
		}
	}

	function handleDrop(event: DragEvent): void {
		event.preventDefault();
		event.stopPropagation();
		isDragging = false;
		if (isUploading) {
			return;
		}
		const files = event.dataTransfer?.files;
		if (files && files.length > 0) {
			void uploadFile(files[0]);
		}
	}

	let unsubscribe: (() => void) | null = null;
	if (userStore) {
		unsubscribe = userStore.subscribe((value) => {
			firstName = deriveGreeting(value, firstName);
		});
	}

	onDestroy(() => {
		unsubscribe?.();
	});
</script>

<svelte:head>
	<title>Spark · Home</title>
</svelte:head>

<section class="spark-welcome">
	<div class="spark-card">
		<p class="spark-eyebrow">Welcome back</p>
		<h1 class="spark-title">
			Hi {firstName}!
			<picture class="spark-comet" aria-hidden="true">
				<source
					srcset="https://fonts.gstatic.com/s/e/notoemoji/latest/2604_fe0f/512.webp"
					type="image/webp"
				/>
				<img
					src="https://fonts.gstatic.com/s/e/notoemoji/latest/2604_fe0f/512.gif"
					alt=""
					width="64"
					height="64"
				/>
			</picture>
		</h1>
		<p class="spark-copy">
			Your revision launchpad—drop study notes here and keep progress sparking.
		</p>
		<div class="spark-uploader-wrapper">
			<div
				class="spark-uploader"
				tabindex={isUploading ? -1 : 0}
				role="button"
				aria-disabled={isUploading ? 'true' : 'false'}
				data-dragging={isDragging ? 'true' : undefined}
				onclick={openFilePicker}
				onkeydown={handleKeydown}
				ondragenter={handleDragEnter}
				ondragover={handleDragOver}
				ondragleave={handleDragLeave}
				ondrop={handleDrop}
			>
				<div class="spark-uploader-cta">
					<span class="spark-uploader-pill">Upload</span>
					<p class="spark-uploader-text">
						Drop a PDF here or choose one to upload (max {MAX_FILE_MB_LABEL}).
					</p>
					<Button type="button" onclick={handleButtonClick} disabled={isUploading}>
						{#if isUploading}
							<span class="spark-upload-spinner" aria-hidden="true"></span>
							<span>Uploading…</span>
						{:else}
							Upload PDF
						{/if}
					</Button>
				</div>
			</div>
			<input
				class="spark-uploader-input"
				type="file"
				accept="application/pdf"
				bind:this={fileInput}
				onchange={handleFileInputChange}
			/>
			<div class="spark-uploader-messages" aria-live="polite">
				{#if uploadError}
					<p class="spark-uploader-feedback" data-kind="error">{uploadError}</p>
				{/if}
				{#if uploadSuccess}
					<p class="spark-uploader-feedback" data-kind="success">{uploadSuccess}</p>
				{/if}
			</div>
		</div>
	</div>
</section>

<style>
	.spark-welcome {
		width: min(110rem, 96vw);
		margin: 0 auto;
		padding-top: clamp(2rem, 4vw, 3rem);
		padding-bottom: clamp(2rem, 4vw, 3rem);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.spark-card {
		display: flex;
		flex-direction: column;
		gap: clamp(1rem, 2vw, 1.5rem);
		padding: clamp(2rem, 3vw, 2.75rem);
		border-radius: clamp(1.8rem, 2.4vw, 2.4rem);
		background: color-mix(in srgb, var(--app-content-bg) 32%, transparent);
		border: 1px solid rgba(148, 163, 184, 0.25);
		box-shadow: 0 28px 80px -50px rgba(15, 23, 42, 0.4);
		backdrop-filter: saturate(140%) blur(18px);
		max-width: clamp(32rem, 50vw, 48rem);
		text-align: center;
	}

	:global([data-theme='dark'] .spark-card),
	:global(:root:not([data-theme='light']) .spark-card) {
		background: rgba(6, 11, 25, 0.6);
		border-color: rgba(148, 163, 184, 0.3);
	}

	.spark-eyebrow {
		margin: 0;
		font-size: 0.85rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: rgba(59, 130, 246, 0.82);
		font-weight: 600;
	}

	.spark-title {
		margin: 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.9rem;
		font-size: clamp(2rem, 3.4vw, 2.8rem);
		font-weight: 650;
		line-height: 1.05;
		color: var(--text-primary, var(--foreground));
	}

	.spark-comet {
		display: inline-flex;
		align-items: center;
	}

	.spark-comet img {
		display: block;
	}

	.spark-copy {
		margin: 0;
		font-size: 1.05rem;
		line-height: 1.6;
		color: var(--app-subtitle-color, rgba(30, 41, 59, 0.75));
	}

	:global([data-theme='dark'] .spark-copy),
	:global(:root:not([data-theme='light']) .spark-copy) {
		color: rgba(203, 213, 225, 0.82);
	}

	.spark-uploader-wrapper {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.75rem;
		width: 100%;
	}

	.spark-uploader {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: clamp(1.75rem, 3vw, 2.75rem);
		min-height: clamp(10rem, 32vw, 12.5rem);
		border: 2px dotted rgba(59, 130, 246, 0.5);
		border-radius: clamp(1.5rem, 2.2vw, 1.95rem);
		background: color-mix(in srgb, var(--app-content-bg) 14%, transparent);
		cursor: pointer;
		transition:
			border-color 160ms ease,
			background-color 160ms ease,
			box-shadow 160ms ease,
			transform 160ms ease;
		outline: none;
	}

	.spark-uploader:hover {
		border-color: rgba(59, 130, 246, 0.75);
		background: color-mix(in srgb, var(--app-content-bg) 20%, transparent);
		transform: translateY(-1px);
	}

	.spark-uploader:focus-visible {
		box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
		border-color: rgba(59, 130, 246, 0.82);
	}

	.spark-uploader[data-dragging='true'] {
		border-color: rgba(59, 130, 246, 0.95);
		background: color-mix(in srgb, rgba(59, 130, 246, 0.25) 45%, transparent);
	}

	.spark-uploader[aria-disabled='true'] {
		cursor: progress;
		opacity: 0.75;
		transform: none;
	}

	:global([data-theme='dark'] .spark-uploader),
	:global(:root:not([data-theme='light']) .spark-uploader) {
		border-color: rgba(96, 165, 250, 0.55);
		background: rgba(15, 23, 42, 0.55);
	}

	:global([data-theme='dark'] .spark-uploader:hover),
	:global(:root:not([data-theme='light']) .spark-uploader:hover) {
		border-color: rgba(129, 199, 255, 0.9);
		background: rgba(30, 64, 175, 0.45);
	}

	:global([data-theme='dark'] .spark-uploader[data-dragging='true']),
	:global(:root:not([data-theme='light']) .spark-uploader[data-dragging='true']) {
		background: rgba(37, 99, 235, 0.35);
	}

	.spark-uploader-cta {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.9rem;
		max-width: 26rem;
	}

	.spark-uploader-pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.35rem 0.85rem;
		border-radius: 9999px;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: rgba(59, 130, 246, 0.9);
		background: rgba(59, 130, 246, 0.12);
	}

	:global([data-theme='dark'] .spark-uploader-pill),
	:global(:root:not([data-theme='light']) .spark-uploader-pill) {
		color: rgba(191, 219, 254, 0.95);
		background: rgba(59, 130, 246, 0.24);
	}

	.spark-uploader-text {
		margin: 0;
		font-size: 1rem;
		line-height: 1.6;
		color: var(--app-subtitle-color, rgba(30, 41, 59, 0.8));
	}

	:global([data-theme='dark'] .spark-uploader-text),
	:global(:root:not([data-theme='light']) .spark-uploader-text) {
		color: rgba(203, 213, 225, 0.85);
	}

	.spark-uploader-input {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		border: 0;
	}

	.spark-uploader-messages {
		min-height: 1.2rem;
		text-align: center;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		align-items: center;
	}

	.spark-uploader-feedback {
		margin: 0;
		font-size: 0.92rem;
	}

	.spark-uploader-feedback[data-kind='error'] {
		color: rgba(220, 38, 38, 0.88);
	}

	.spark-uploader-feedback[data-kind='success'] {
		color: rgba(22, 163, 74, 0.9);
	}

	.spark-upload-spinner {
		display: inline-block;
		width: 1.1rem;
		height: 1.1rem;
		border-radius: 999px;
		border: 2px solid currentColor;
		border-right-color: transparent;
		animation: spark-spin 0.8s linear infinite;
	}

	.spark-upload-spinner + span {
		margin-left: 0.5rem;
	}

	@keyframes spark-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
