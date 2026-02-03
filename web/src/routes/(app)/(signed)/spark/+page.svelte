<script lang="ts">
	import { browser } from '$app/environment';
	import { getContext, onMount } from 'svelte';
	import { fromStore, type Readable } from 'svelte/store';
	import { getFirestore, doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
	import { getAuth, onIdTokenChanged } from 'firebase/auth';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Camera from '@lucide/svelte/icons/camera';
	import Mic from '@lucide/svelte/icons/mic';
	import Plus from '@lucide/svelte/icons/plus';
	import type { PageData } from './$types';
	import { getFirebaseApp } from '$lib/utils/firebaseClient';
	import { ChatInput } from '$lib/components/chat/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { renderMarkdown } from '$lib/markdown';
	import { streamSse } from '$lib/client/sse';
	import {
		SparkAgentAttachmentSchema,
		SparkAgentConversationSchema,
		type SparkAgentFile,
		type SparkAgentAttachment,
		type SparkAgentAttachmentStatus,
		type SparkAgentConversation,
		type SparkAgentMessage
	} from '@spark/schemas';

	type ClientUser = NonNullable<PageData['user']> | null;
	type LocalAttachment = {
		localId: string;
		id?: string;
		filename: string;
		contentType: string;
		sizeBytes: number;
		status: SparkAgentAttachmentStatus;
		fingerprint: string;
		previewUrl?: string | null;
		storagePath?: string;
		error?: string;
	};
	type MessageAttachment = {
		kind: 'image' | 'file';
		file: SparkAgentFile;
	};

	const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
	const MAX_TOTAL_SIZE_BYTES = 50 * 1024 * 1024;
	const MAX_FILES_PER_CONVERSATION = 10;

	let { data }: { data: PageData } = $props();

	const userStore = getContext<Readable<ClientUser> | undefined>('spark:user');
	const userSnapshot = userStore ? fromStore(userStore) : null;
	const user = $derived(userSnapshot?.current ?? data.user ?? null);
	const userId = $derived(user?.uid ?? null);

	let conversationId = $state<string | null>(null);
	let conversation = $state<SparkAgentConversation | null>(null);
	let draft = $state('');
	let sending = $state(false);
	let error = $state<string | null>(null);
	let streamingByMessageId = $state<Record<string, string>>({});
	let streamingThoughtsByMessageId = $state<Record<string, string>>({});
	let authReady = $state(false);
	let composerExpanded = $state(false);
	let composerRef = $state<HTMLDivElement | null>(null);
	let streamAbort = $state<AbortController | null>(null);
	let pendingScrollText = $state<string | null>(null);
	let pendingScrollMessageId = $state<string | null>(null);
	let lastScrollMessageId = $state<string | null>(null);
	let attachmentInputRef = $state<HTMLInputElement | null>(null);
	let photoInputRef = $state<HTMLInputElement | null>(null);
	let agentStreamRef = $state<HTMLDivElement | null>(null);
	let attachments = $state<LocalAttachment[]>([]);
	let attachmentError = $state<string | null>(null);
	let lastAttachmentConversationId = $state<string | null>(null);
	const pendingRemovalByLocalId = new Set<string>();
	const ignoredAttachmentIdsByConversation = new Map<string, Set<string>>();
	const ignoredFingerprintsByConversation = new Map<string, Set<string>>();
	const copyResetTimers = new WeakMap<HTMLButtonElement, number>();
	let tooltipState = $state({
		text: '',
		x: 0,
		y: 0,
		visible: false
	});

	const isComposerExpanded = $derived(composerExpanded);
	const isMobileDevice = $derived.by(() => {
		if (!browser) {
			return false;
		}
		const userAgentData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } })
			.userAgentData;
		if (userAgentData && typeof userAgentData.mobile === 'boolean') {
			return userAgentData.mobile;
		}
		if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
			return true;
		}
		return navigator.maxTouchPoints > 1 && /Mac/i.test(navigator.platform);
	});
	const isMacPlatform = $derived.by(() => {
		if (!browser) {
			return false;
		}
		return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
	});
	const attachmentShortcutLabel = $derived.by(() => {
		if (!browser || isMobileDevice) {
			return null;
		}
		return isMacPlatform ? '⌘U' : 'Ctrl+U';
	});
	const canTakePhoto = $derived(isMobileDevice);
	const conversationAttachments = $derived(conversation?.attachments ?? []);
	const activeConversationAttachments = $derived(
		conversationAttachments.filter((entry) => entry.status !== 'failed')
	);
	const hasPendingUploads = $derived(
		attachments.some((entry) => entry.status === 'uploading')
	);
	const readyAttachments = $derived(
		attachments.filter((entry) => entry.status === 'attaching')
	);
	const canSend = $derived(
		!sending && !hasPendingUploads && (draft.trim().length > 0 || readyAttachments.length > 0)
	);

	function resolveConversationStorageKey(uid: string): string {
		return `spark:agent:conversation:${uid}`;
	}

	function resolveAttachmentScopeKey(value: string | null): string {
		return value ?? 'draft';
	}

	function resolveIgnoredAttachmentIds(value: string | null): Set<string> {
		const key = resolveAttachmentScopeKey(value);
		const existing = ignoredAttachmentIdsByConversation.get(key);
		if (existing) {
			return existing;
		}
		const created = new Set<string>();
		ignoredAttachmentIdsByConversation.set(key, created);
		return created;
	}

	function resolveIgnoredFingerprints(value: string | null): Set<string> {
		const key = resolveAttachmentScopeKey(value);
		const existing = ignoredFingerprintsByConversation.get(key);
		if (existing) {
			return existing;
		}
		const created = new Set<string>();
		ignoredFingerprintsByConversation.set(key, created);
		return created;
	}

	function clearIgnoredForConversation(value: string | null): void {
		const key = resolveAttachmentScopeKey(value);
		ignoredAttachmentIdsByConversation.delete(key);
		ignoredFingerprintsByConversation.delete(key);
	}

	function createConversationId(): string {
		if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
			return crypto.randomUUID();
		}
		return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
	}

	function resolveFileExtension(name: string): string {
		const parts = name.split('.');
		if (parts.length < 2) {
			return '';
		}
		return parts[parts.length - 1]?.toLowerCase() ?? '';
	}

	function resolveAttachmentFingerprint(
		filename: string,
		sizeBytes: number,
		contentType: string
	): string {
		return `${filename}|${sizeBytes}|${contentType}`;
	}

	function isImageType(contentType: string, filename: string): boolean {
		if (contentType.startsWith('image/')) {
			return true;
		}
		const ext = resolveFileExtension(filename);
		return ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'webp';
	}

	function isPdfType(contentType: string, filename: string): boolean {
		if (contentType === 'application/pdf') {
			return true;
		}
		return resolveFileExtension(filename) === 'pdf';
	}

	function isSupportedClientFile(file: File): boolean {
		const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
		if (file.type && allowed.has(file.type)) {
			return true;
		}
		const ext = resolveFileExtension(file.name);
		return ['jpg', 'jpeg', 'png', 'webp', 'pdf'].includes(ext);
	}

	function cleanupPreviewUrl(url: string | null | undefined): void {
		if (!url) {
			return;
		}
		if (url.startsWith('blob:')) {
			URL.revokeObjectURL(url);
		}
	}

	function updateLocalAttachment(localId: string, update: Partial<LocalAttachment>): void {
		attachments = attachments.map((entry) => {
			if (entry.localId !== localId) {
				return entry;
			}
			return { ...entry, ...update };
		});
	}

	function resolveAttachmentTotals(
		local: LocalAttachment[],
		server: SparkAgentAttachment[],
		ignoredIds: Set<string>,
		ignoredFingerprints: Set<string>
	): { count: number; sizeBytes: number } {
		const activeServer = server.filter((entry) => {
			if (entry.status === 'failed') {
				return false;
			}
			if (ignoredIds.has(entry.id)) {
				return false;
			}
			const fingerprint = resolveAttachmentFingerprint(
				entry.filename ?? '',
				entry.sizeBytes,
				entry.contentType
			);
			if (ignoredFingerprints.has(fingerprint)) {
				return false;
			}
			return true;
		});
		const serverIds = new Set(activeServer.map((entry) => entry.id));
		let count = activeServer.length;
		let sizeBytes = activeServer.reduce((sum, entry) => sum + entry.sizeBytes, 0);
		for (const entry of local) {
			if (entry.status === 'failed') {
				continue;
			}
			if (entry.id && serverIds.has(entry.id)) {
				continue;
			}
			count += 1;
			sizeBytes += entry.sizeBytes;
		}
		return { count, sizeBytes };
	}

	function reconcileAttachments(
		local: LocalAttachment[],
		server: SparkAgentAttachment[],
		ignoredIds: Set<string>,
		ignoredFingerprints: Set<string>
	): LocalAttachment[] {
		const serverMap = new Map(server.map((entry) => [entry.id, entry]));
		const next: LocalAttachment[] = [];
		const usedServerIds = new Set<string>();
		const seenIds = new Set<string>();

		const fingerprintLocal = (entry: LocalAttachment): string =>
			resolveAttachmentFingerprint(entry.filename, entry.sizeBytes, entry.contentType);
		const fingerprintServer = (entry: SparkAgentAttachment): string =>
			resolveAttachmentFingerprint(entry.filename ?? '', entry.sizeBytes, entry.contentType);

		for (const entry of local) {
			if (ignoredFingerprints.has(entry.fingerprint)) {
				cleanupPreviewUrl(entry.previewUrl);
				continue;
			}
				if (entry.id) {
					if (seenIds.has(entry.id)) {
						cleanupPreviewUrl(entry.previewUrl);
						continue;
					}
					if (ignoredIds.has(entry.id)) {
						cleanupPreviewUrl(entry.previewUrl);
						continue;
					}
					seenIds.add(entry.id);
				}
			let matchedServer: SparkAgentAttachment | null = null;
			if (!entry.id) {
				const candidateFingerprint = fingerprintLocal(entry);
				for (const serverEntry of server) {
					if (usedServerIds.has(serverEntry.id)) {
						continue;
					}
						if (serverEntry.status === 'failed') {
							continue;
						}
						if (ignoredIds.has(serverEntry.id)) {
							continue;
						}
						if (ignoredFingerprints.has(fingerprintServer(serverEntry))) {
							continue;
						}
					if (fingerprintServer(serverEntry) !== candidateFingerprint) {
						continue;
					}
					matchedServer = serverEntry;
					break;
				}
				if (matchedServer) {
					usedServerIds.add(matchedServer.id);
					seenIds.add(matchedServer.id);
					if (matchedServer.status === 'attached') {
						cleanupPreviewUrl(entry.previewUrl);
						continue;
					}
					next.push({
						...entry,
						id: matchedServer.id,
						status: matchedServer.status,
						filename: matchedServer.filename ?? entry.filename,
						contentType: matchedServer.contentType,
						sizeBytes: matchedServer.sizeBytes,
						storagePath: matchedServer.storagePath,
						error: matchedServer.error
					});
					continue;
				}
			}
			if (entry.id && serverMap.has(entry.id)) {
				const serverEntry = serverMap.get(entry.id);
				if (!serverEntry) {
					continue;
				}
				if (ignoredIds.has(serverEntry.id)) {
					cleanupPreviewUrl(entry.previewUrl);
					continue;
				}
				if (ignoredFingerprints.has(fingerprintServer(serverEntry))) {
					cleanupPreviewUrl(entry.previewUrl);
					continue;
				}
				usedServerIds.add(entry.id);
				if (serverEntry.status === 'attached') {
					cleanupPreviewUrl(entry.previewUrl);
					continue;
				}
				next.push({
					...entry,
					status: serverEntry.status,
					filename: serverEntry.filename ?? entry.filename,
					contentType: serverEntry.contentType,
					sizeBytes: serverEntry.sizeBytes,
					storagePath: serverEntry.storagePath,
					error: serverEntry.error
				});
				continue;
			}
			if (entry.status === 'attached') {
				cleanupPreviewUrl(entry.previewUrl);
				continue;
			}
			next.push(entry);
		}

		for (const serverEntry of server) {
			if (serverEntry.status === 'attached') {
				continue;
			}
			if (usedServerIds.has(serverEntry.id)) {
				continue;
			}
			if (ignoredIds.has(serverEntry.id)) {
				continue;
			}
			if (ignoredFingerprints.has(fingerprintServer(serverEntry))) {
				continue;
			}
			next.push({
				localId: serverEntry.id,
				id: serverEntry.id,
				filename: serverEntry.filename ?? 'Attachment',
				contentType: serverEntry.contentType,
				sizeBytes: serverEntry.sizeBytes,
				status: serverEntry.status,
				storagePath: serverEntry.storagePath,
				error: serverEntry.error,
				fingerprint: fingerprintServer(serverEntry)
			});
		}

		return next;
	}

	function attachmentsEqual(a: LocalAttachment[], b: LocalAttachment[]): boolean {
		if (a.length !== b.length) {
			return false;
		}
		for (let i = 0; i < a.length; i += 1) {
			const left = a[i];
			const right = b[i];
			if (!left || !right) {
				return false;
			}
			if (left.localId !== right.localId) {
				return false;
			}
			if (left.id !== right.id) {
				return false;
			}
			if (left.status !== right.status) {
				return false;
			}
			if (left.error !== right.error) {
				return false;
			}
			if (left.fingerprint !== right.fingerprint) {
				return false;
			}
		}
		return true;
	}

	function extractTextParts(message: SparkAgentMessage): string {
		const chunks: string[] = [];
		for (const part of message.content) {
			if (part.type === 'text') {
				chunks.push(part.text);
			}
		}
		return chunks.join('\n').trim();
	}

	function resolveMessageAttachments(message: SparkAgentMessage): MessageAttachment[] {
		const result: MessageAttachment[] = [];
		for (const part of message.content) {
			if (part.type === 'image') {
				result.push({ kind: 'image', file: part.file });
				continue;
			}
			if (part.type === 'file') {
				result.push({ kind: 'file', file: part.file });
			}
		}
		return result;
	}

	function resolveAttachmentName(file: SparkAgentFile): string {
		if (file.filename && file.filename.trim().length > 0) {
			return file.filename;
		}
		const fallback = file.storagePath.split('/').pop();
		return fallback && fallback.length > 0 ? fallback : 'Attachment';
	}

	function resolveAttachmentDownloadUrl(
		activeConversationId: string | null,
		fileId: string | undefined
	): string | null {
		if (!activeConversationId || !fileId) {
			return null;
		}
		const params = new URLSearchParams();
		params.set('conversationId', activeConversationId);
		params.set('fileId', fileId);
		return `/api/spark/agent/attachments?${params.toString()}`;
	}

	function resolveMessageText(message: SparkAgentMessage): string {
		const base = extractTextParts(message);
		const streaming = streamingByMessageId[message.id];
		if (streaming && streaming.length >= base.length) {
			return streaming;
		}
		return base;
	}

	function formatBytes(bytes: number): string {
		if (!Number.isFinite(bytes) || bytes <= 0) {
			return '0B';
		}
		if (bytes < 1024) {
			return `${Math.round(bytes)}B`;
		}
		const units = ['KB', 'MB', 'GB', 'TB'];
		let value = bytes;
		let unitIndex = -1;
		while (value >= 1024 && unitIndex < units.length - 1) {
			value /= 1024;
			unitIndex += 1;
		}
		const unit = units[unitIndex] ?? 'KB';
		return `${value.toFixed(2)}${unit}`;
	}

	function showTooltip(node: HTMLElement, text: string): void {
		if (!text || text.trim().length === 0) {
			tooltipState = { ...tooltipState, visible: false };
			return;
		}
		const rect = node.getBoundingClientRect();
		tooltipState = {
			text,
			x: rect.left + rect.width / 2,
			y: rect.top,
			visible: true
		};
	}

	function hideTooltip(): void {
		tooltipState = { ...tooltipState, visible: false };
	}

	function tooltipAction(node: HTMLElement, text: string) {
		let currentText = text;
		const handleEnter = () => showTooltip(node, currentText);
		const handleMove = () => showTooltip(node, currentText);
		const handleLeave = () => hideTooltip();
		node.addEventListener('mouseenter', handleEnter);
		node.addEventListener('mousemove', handleMove);
		node.addEventListener('mouseleave', handleLeave);
		node.addEventListener('focusin', handleEnter);
		node.addEventListener('focusout', handleLeave);
		return {
			update(nextText: string) {
				currentText = nextText;
				if (tooltipState.visible) {
					showTooltip(node, currentText);
				}
			},
			destroy() {
				node.removeEventListener('mouseenter', handleEnter);
				node.removeEventListener('mousemove', handleMove);
				node.removeEventListener('mouseleave', handleLeave);
				node.removeEventListener('focusin', handleEnter);
				node.removeEventListener('focusout', handleLeave);
			}
		};
	}

	async function copyText(value: string): Promise<boolean> {
		if (!browser) {
			return false;
		}
		if (navigator.clipboard?.writeText) {
			try {
				await navigator.clipboard.writeText(value);
				return true;
			} catch {
				// fall through
			}
		}
		try {
			const textarea = document.createElement('textarea');
			textarea.value = value;
			textarea.setAttribute('readonly', 'true');
			textarea.style.position = 'fixed';
			textarea.style.opacity = '0';
			textarea.style.pointerEvents = 'none';
			document.body.appendChild(textarea);
			textarea.select();
			const ok = document.execCommand('copy');
			textarea.remove();
			return ok;
		} catch {
			return false;
		}
	}

	function setCopyButtonState(
		button: HTMLButtonElement,
		state: 'idle' | 'copied' | 'error' | 'empty',
		label: string
	): void {
		button.setAttribute('aria-label', label);
		if (state === 'idle') {
			delete button.dataset.copyState;
		} else {
			button.dataset.copyState = state;
		}
		const existingTimer = copyResetTimers.get(button);
		if (existingTimer !== undefined) {
			window.clearTimeout(existingTimer);
		}
		const timeoutId = window.setTimeout(() => {
			button.setAttribute('aria-label', 'Copy code');
			delete button.dataset.copyState;
		}, 1400);
		copyResetTimers.set(button, timeoutId);
	}

	async function handleCodeCopyClick(event: MouseEvent): Promise<void> {
		const target = event.target as HTMLElement | null;
		const button = target?.closest<HTMLButtonElement>('[data-code-copy]');
		if (!button) {
			return;
		}
		event.preventDefault();
		const codeEl = button.closest('.code-block')?.querySelector('code');
		const code = codeEl?.textContent ?? '';
		if (!code) {
			setCopyButtonState(button, 'empty', 'No code');
			return;
		}
		const ok = await copyText(code);
		setCopyButtonState(button, ok ? 'copied' : 'error', ok ? 'Copied' : 'Copy failed');
	}

	function appendStreamingThoughts(current: string, delta: string): string {
		const next = `${current}${delta}`;
		const lines = next.split(/\r?\n/u);
		if (lines.length <= 4) {
			return next;
		}
		return lines.slice(-4).join('\n');
	}

	function reconcileStreaming(nextConversation: SparkAgentConversation): void {
		const next: Record<string, string> = {};
		const messageMap = new Map<string, SparkAgentMessage>();
		for (const message of nextConversation.messages) {
			messageMap.set(message.id, message);
		}
		for (const [id, value] of Object.entries(streamingByMessageId)) {
			const message = messageMap.get(id);
			if (!message) {
				continue;
			}
			const text = extractTextParts(message);
			if (text.length < value.length) {
				next[id] = value;
			}
		}
		streamingByMessageId = next;
	}

	function reconcileStreamingThoughts(nextConversation: SparkAgentConversation): void {
		const next: Record<string, string> = {};
		const messageIds = new Set(nextConversation.messages.map((message) => message.id));
		for (const [id, value] of Object.entries(streamingThoughtsByMessageId)) {
			if (!messageIds.has(id)) {
				continue;
			}
			if (value.trim().length === 0) {
				continue;
			}
			next[id] = value;
		}
		streamingThoughtsByMessageId = next;
	}

	const messages = $derived(conversation?.messages ?? []);
	const assistantMessageCount = $derived.by(() => {
		let count = 0;
		for (const message of messages) {
			if (message.role === 'assistant') {
				count += 1;
			}
		}
		return count;
	});
	const shouldUseThreadPadding = $derived(assistantMessageCount > 1);

	function setConversationId(nextId: string | null): void {
		conversationId = nextId;
		if (!browser) {
			return;
		}
		if (!userId) {
			return;
		}
		const key = resolveConversationStorageKey(userId);
		if (!nextId) {
			window.localStorage.removeItem(key);
			return;
		}
		window.localStorage.setItem(key, nextId);
	}

	function resetConversation(): void {
		const previousConversationId = conversationId;
		setConversationId(null);
		conversation = null;
		streamingByMessageId = {};
		streamingThoughtsByMessageId = {};
		error = null;
		attachmentError = null;
		draft = '';
		pendingScrollText = null;
		pendingScrollMessageId = null;
		lastScrollMessageId = null;
		for (const entry of attachments) {
			cleanupPreviewUrl(entry.previewUrl);
		}
		attachments = [];
		pendingRemovalByLocalId.clear();
		clearIgnoredForConversation(previousConversationId);
	}

	function openFilePicker(input: HTMLInputElement | null): void {
		if (!input) {
			return;
		}
		input.value = '';
		input.click();
	}

	function handleAttachmentSelect(): void {
		openFilePicker(attachmentInputRef);
	}

	function handleTakePhotoSelect(): void {
		openFilePicker(photoInputRef);
	}

	function resolveClientContentType(file: File): string {
		if (file.type) {
			return file.type;
		}
		const ext = resolveFileExtension(file.name);
		if (ext === 'pdf') {
			return 'application/pdf';
		}
		if (ext === 'png') {
			return 'image/png';
		}
		if (ext === 'webp') {
			return 'image/webp';
		}
		if (ext === 'jpg' || ext === 'jpeg') {
			return 'image/jpeg';
		}
		return '';
	}

	async function removeAttachmentOnServer(
		activeConversationId: string,
		fileId: string
	): Promise<void> {
		await fetch('/api/spark/agent/attachments', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				conversationId: activeConversationId,
				fileId
			})
		});
	}

	async function uploadAttachment(
		localId: string,
		file: File,
		activeConversationId: string
	): Promise<void> {
		const form = new FormData();
		form.append('conversationId', activeConversationId);
		form.append('file', file);
		try {
			const response = await fetch('/api/spark/agent/attachments', {
				method: 'POST',
				body: form
			});
			const payload = await response.json().catch(() => null);
			if (!response.ok) {
				const message = payload?.message ?? 'Upload failed. Please try again.';
				if (pendingRemovalByLocalId.has(localId)) {
					pendingRemovalByLocalId.delete(localId);
					return;
				}
				updateLocalAttachment(localId, { status: 'failed', error: message });
				attachmentError = message;
				return;
			}
			const parsed = SparkAgentAttachmentSchema.safeParse(payload?.attachment);
			if (!parsed.success) {
				if (pendingRemovalByLocalId.has(localId)) {
					pendingRemovalByLocalId.delete(localId);
					return;
				}
				updateLocalAttachment(localId, {
					status: 'failed',
					error: 'Upload failed. Please try again.'
				});
				return;
			}
			const attachment = parsed.data;
			if (pendingRemovalByLocalId.has(localId)) {
				pendingRemovalByLocalId.delete(localId);
				resolveIgnoredAttachmentIds(activeConversationId).add(attachment.id);
				try {
					await removeAttachmentOnServer(activeConversationId, attachment.id);
				} catch (removeError) {
					console.warn('Failed to remove attachment after upload', removeError);
				}
				return;
			}
			resolveIgnoredAttachmentIds(activeConversationId).delete(attachment.id);
				updateLocalAttachment(localId, {
					id: attachment.id,
					status: attachment.status,
					filename: attachment.filename ?? file.name,
					contentType: attachment.contentType,
					sizeBytes: attachment.sizeBytes,
					storagePath: attachment.storagePath,
					error: attachment.error
				});
			} catch (uploadError) {
			if (pendingRemovalByLocalId.has(localId)) {
				pendingRemovalByLocalId.delete(localId);
				return;
			}
			console.error('Attachment upload failed', uploadError);
			updateLocalAttachment(localId, {
				status: 'failed',
				error: 'Upload failed. Please try again.'
			});
		}
	}

	async function addAttachments(files: File[]): Promise<void> {
		if (!userId) {
			error = 'Unable to upload files right now. Please refresh and try again.';
			return;
		}
		if (files.length === 0) {
			return;
		}
		attachmentError = null;
		let nextConversationId = conversationId;
		if (!nextConversationId) {
			nextConversationId = createConversationId();
			setConversationId(nextConversationId);
		}

		let { count, sizeBytes } = resolveAttachmentTotals(
			attachments,
			activeConversationAttachments,
			resolveIgnoredAttachmentIds(nextConversationId),
			resolveIgnoredFingerprints(nextConversationId)
		);
		for (const file of files) {
			if (!isSupportedClientFile(file)) {
				attachmentError = 'Only JPG, PNG, WEBP, or PDF files are supported.';
				continue;
			}
			if (file.size > MAX_FILE_SIZE_BYTES) {
				attachmentError = 'Each file must be 25 MB or smaller.';
				continue;
			}
			if (count >= MAX_FILES_PER_CONVERSATION) {
				attachmentError = 'You can attach up to 10 files per conversation.';
				break;
			}
			if (sizeBytes + file.size > MAX_TOTAL_SIZE_BYTES) {
				attachmentError = 'Attachments are limited to 50 MB per conversation.';
				continue;
			}

			const resolvedContentType = resolveClientContentType(file);
			const fingerprint = resolveAttachmentFingerprint(file.name, file.size, resolvedContentType);
			resolveIgnoredFingerprints(nextConversationId).delete(fingerprint);
			const localId = createConversationId();
			const previewUrl = isImageType(resolvedContentType, file.name)
				? URL.createObjectURL(file)
				: null;
			const entry: LocalAttachment = {
				localId,
				filename: file.name,
				contentType: resolvedContentType,
				sizeBytes: file.size,
				status: 'uploading',
				fingerprint,
				previewUrl
			};
			attachments = [...attachments, entry];
			count += 1;
			sizeBytes += file.size;
			void uploadAttachment(localId, file, nextConversationId);
		}
	}

	async function handleFileInputChange(event: Event): Promise<void> {
		const target = event.target as HTMLInputElement | null;
		if (!target) {
			return;
		}
		const selected = target.files ? Array.from(target.files) : [];
		target.value = '';
		if (selected.length === 0) {
			return;
		}
		await addAttachments(selected);
	}

	async function removeAttachment(entry: LocalAttachment): Promise<void> {
		attachments = attachments.filter((item) => item.localId !== entry.localId);
		cleanupPreviewUrl(entry.previewUrl);
		pendingRemovalByLocalId.add(entry.localId);
		resolveIgnoredFingerprints(conversationId).add(entry.fingerprint);
		if (!entry.id || !conversationId) {
			return;
		}
		resolveIgnoredAttachmentIds(conversationId).add(entry.id);
		try {
			await removeAttachmentOnServer(conversationId, entry.id);
		} catch (removeError) {
			console.warn('Failed to remove attachment', removeError);
		}
	}

	function clearComposerAttachments(
		activeConversationId: string,
		entries: LocalAttachment[]
	): void {
		if (entries.length === 0) {
			return;
		}
		const ignoredIds = resolveIgnoredAttachmentIds(activeConversationId);
		const ignoredFingerprints = resolveIgnoredFingerprints(activeConversationId);
		const localIds = new Set(entries.map((entry) => entry.localId));
		for (const entry of entries) {
			cleanupPreviewUrl(entry.previewUrl);
			ignoredFingerprints.add(entry.fingerprint);
			if (entry.id) {
				ignoredIds.add(entry.id);
			}
		}
		attachments = attachments.filter((entry) => !localIds.has(entry.localId));
	}

	async function sendMessage(): Promise<void> {
		const trimmed = draft.trim();
		if (sending || hasPendingUploads) {
			return;
		}
		const attachmentsToSend = readyAttachments.filter(
			(entry) => entry.status === 'attaching' && entry.id && entry.storagePath
		);
		if (!trimmed && attachmentsToSend.length === 0) {
			return;
		}
		if (!userId) {
			error = 'Unable to send right now. Please refresh and try again.';
			return;
		}

		sending = true;
		error = null;
		attachmentError = null;
		pendingScrollText = trimmed || null;
		pendingScrollMessageId = null;
		draft = '';

		let nextConversationId = conversationId;
		if (!nextConversationId) {
			nextConversationId = createConversationId();
			setConversationId(nextConversationId);
		}

		const abortController = new AbortController();
		streamAbort = abortController;
		let activeAssistantId: string | null = null;
		let clearedComposer = false;

		try {
			await streamSse(
				'/api/spark/agent/messages',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					signal: abortController.signal,
						body: JSON.stringify({
							conversationId: nextConversationId,
							text: trimmed || undefined,
							attachments: attachmentsToSend.map((entry) => ({
								id: entry.id,
								storagePath: entry.storagePath,
								contentType: entry.contentType,
								filename: entry.filename,
								sizeBytes: entry.sizeBytes
							}))
						})
					},
				{
					onEvent: (event) => {
						if (event.event === 'meta') {
							try {
								const payload = JSON.parse(event.data) as {
									conversationId: string;
									messageId?: string;
									assistantMessageId?: string;
								};
								if (payload.conversationId) {
									setConversationId(payload.conversationId);
								}
								if (!clearedComposer) {
									clearComposerAttachments(nextConversationId, attachmentsToSend);
									clearedComposer = true;
								}
								if (payload.messageId) {
									pendingScrollMessageId = payload.messageId;
								}
								if (payload.assistantMessageId) {
									activeAssistantId = payload.assistantMessageId;
									streamingByMessageId = {
										...streamingByMessageId,
										[payload.assistantMessageId]: ''
									};
									streamingThoughtsByMessageId = {
										...streamingThoughtsByMessageId,
										[payload.assistantMessageId]: ''
									};
								}
							} catch {
								// ignore
							}
							return;
						}
						if (event.event === 'thought') {
							if (!activeAssistantId) {
								return;
							}
							const existing = streamingThoughtsByMessageId[activeAssistantId] ?? '';
							const nextThoughts = appendStreamingThoughts(existing, event.data);
							streamingThoughtsByMessageId = {
								...streamingThoughtsByMessageId,
								[activeAssistantId]: nextThoughts
							};
							return;
						}
						if (event.event === 'text') {
							if (!activeAssistantId) {
								return;
							}
							const existing = streamingByMessageId[activeAssistantId] ?? '';
							const nextText = `${existing}${event.data}`;
							streamingByMessageId = {
								...streamingByMessageId,
								[activeAssistantId]: nextText
							};
							return;
						}
						if (event.event === 'error') {
							try {
								const payload = JSON.parse(event.data) as { message?: string };
								error = payload.message ?? 'Spark AI Agent ran into a problem.';
							} catch {
								error = 'Spark AI Agent ran into a problem.';
							}
							if (activeAssistantId) {
								const next = { ...streamingThoughtsByMessageId };
								delete next[activeAssistantId];
								streamingThoughtsByMessageId = next;
							}
							return;
						}
						if (event.event === 'done') {
							if (activeAssistantId) {
								const next = { ...streamingThoughtsByMessageId };
								delete next[activeAssistantId];
								streamingThoughtsByMessageId = next;
							}
							return;
						}
					},
					onOpen: () => {
						// no-op
					}
				}
			);
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') {
				// stream stopped by user
			} else {
				console.error('Spark AI Agent request failed', err);
				error = err instanceof Error ? err.message : 'Unable to reach Spark AI Agent.';
			}
		} finally {
			sending = false;
			streamAbort = null;
			composerExpanded = false;
		}
	}

	onMount(() => {
		if (!browser) {
			return;
		}
		const handleKeydown = (event: KeyboardEvent) => {
			if (sending || event.defaultPrevented) {
				return;
			}
			if (event.repeat || event.altKey || event.shiftKey) {
				return;
			}
			if (event.key.toLowerCase() !== 'u') {
				return;
			}
			const usesMeta = isMacPlatform;
			const hasShortcut = usesMeta ? event.metaKey : event.ctrlKey;
			if (!hasShortcut) {
				return;
			}
			event.preventDefault();
			openFilePicker(attachmentInputRef);
		};
		window.addEventListener('keydown', handleKeydown);
		const auth = getAuth(getFirebaseApp());
		if (auth.currentUser) {
			authReady = true;
		} else {
			const stopAuth = onIdTokenChanged(auth, (firebaseUser) => {
				if (!firebaseUser) {
					return;
				}
				authReady = true;
				stopAuth();
			});
		}
		if (userId) {
			const stored = window.localStorage.getItem(resolveConversationStorageKey(userId));
			if (stored && stored.trim().length > 0) {
				conversationId = stored.trim();
			}
		}
		return () => {
			window.removeEventListener('keydown', handleKeydown);
		};
	});

	$effect(() => {
		if (!browser) {
			return;
		}
		if (!userId || !conversationId || !authReady) {
			conversation = null;
			return;
		}
		const db = getFirestore(getFirebaseApp());
		const ref = doc(db, userId, 'client', 'conversations', conversationId);
		let stop: Unsubscribe | null = null;
		stop = onSnapshot(
			ref,
			(snap) => {
				if (!snap.exists()) {
					conversation = null;
					return;
				}
				const parsed = SparkAgentConversationSchema.safeParse(snap.data());
				if (!parsed.success) {
					console.warn('Invalid Spark AI Agent conversation payload', parsed.error.flatten());
					return;
				}
				conversation = parsed.data;
				reconcileStreaming(parsed.data);
				reconcileStreamingThoughts(parsed.data);
			},
			(snapError) => {
				console.warn('Firestore subscription failed', snapError);
				error = 'Spark AI Agent could not load this conversation right now.';
			}
		);
		return () => {
			stop?.();
		};
	});

	$effect(() => {
		if (conversationId === lastAttachmentConversationId) {
			return;
		}
		if (lastAttachmentConversationId && conversationId !== lastAttachmentConversationId) {
			for (const entry of attachments) {
				cleanupPreviewUrl(entry.previewUrl);
			}
			attachments = [];
			attachmentError = null;
			pendingRemovalByLocalId.clear();
			clearIgnoredForConversation(lastAttachmentConversationId);
		}
		lastAttachmentConversationId = conversationId;
	});

	$effect(() => {
		const next = reconcileAttachments(
			attachments,
			activeConversationAttachments,
			resolveIgnoredAttachmentIds(conversationId),
			resolveIgnoredFingerprints(conversationId)
		);
		if (!attachmentsEqual(attachments, next)) {
			attachments = next;
		}
	});

	$effect(() => {
		if (!draft) {
			composerExpanded = false;
		}
	});

	$effect(() => {
		if (!browser || !agentStreamRef) {
			return;
		}
		const stream = agentStreamRef;
		stream.addEventListener('click', handleCodeCopyClick);
		return () => {
			stream.removeEventListener('click', handleCodeCopyClick);
		};
	});

	$effect(() => {
		if (!browser || !composerRef) {
			return;
		}
		const shell = composerRef.closest('.agent-shell') as HTMLElement | null;
		const target = shell ?? document.documentElement;
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			const height = entry ? entry.contentRect.height : 0;
			target.style.setProperty('--spark-composer-offset', `${height + 16}px`);
		});
		observer.observe(composerRef);
		return () => {
			observer.disconnect();
			target.style.removeProperty('--spark-composer-offset');
		};
	});

	$effect(() => {
		if (!browser || !conversation || (!pendingScrollText && !pendingScrollMessageId)) {
			return;
		}
		const messages = conversation.messages;
		let target: SparkAgentMessage | null = null;
		if (pendingScrollMessageId) {
			for (let i = messages.length - 1; i >= 0; i -= 1) {
				const message = messages[i];
				if (message.id === pendingScrollMessageId) {
					target = message;
					break;
				}
			}
		}
		if (!target && pendingScrollText) {
			for (let i = messages.length - 1; i >= 0; i -= 1) {
				const message = messages[i];
				if (message.role !== 'user') {
					continue;
				}
				if (extractTextParts(message).trim() === pendingScrollText) {
					target = message;
					break;
				}
			}
		}
		if (!target || target.id === lastScrollMessageId) {
			return;
		}
		lastScrollMessageId = target.id;
		pendingScrollText = null;
		pendingScrollMessageId = null;
		requestAnimationFrame(() => {
			const node = document.querySelector(`[data-message-id="${target?.id}"]`);
			const container = document.querySelector('.app-main');
			if (!(node instanceof HTMLElement) || !(container instanceof HTMLElement)) {
				return;
			}
			const appPage = document.querySelector('.app-page');
			if (appPage instanceof HTMLElement && appPage.scrollTop !== 0) {
				appPage.scrollTop = 0;
			}
			const nodeRect = node.getBoundingClientRect();
			const containerRect = container.getBoundingClientRect();
			const offset = nodeRect.top - containerRect.top;
			const padding = 16;
			const targetTop = container.scrollTop + offset - padding;
			container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
		});
	});
</script>

<svelte:head>
	<title>Spark AI Agent</title>
</svelte:head>

<section class={`agent-shell ${messages.length > 0 ? 'has-thread' : ''}`}>
	<div class="agent-layout">
		<div class="agent-toolbar">
			<Button variant="outline" size="sm" onclick={resetConversation} disabled={sending}>
				New chat
			</Button>
			<Button variant="ghost" size="sm" href="/spark/agents">Agents</Button>
		</div>

		<div class="agent-stream" bind:this={agentStreamRef}>
			{#if error}
				<div class="agent-error" role="alert">
					{error}
				</div>
			{/if}

			{#if messages.length === 0}
				<div class="agent-empty">
					<h2>Start a new conversation</h2>
					<p>
						Spark AI Agent can map out lessons, generate practice prompts, and review your uploads.
					</p>
					<div class="agent-empty__examples">
						<span>“Plan a 3-day GCSE Biology revision sprint.”</span>
						<span>“Help me break down this algorithm into steps.”</span>
						<span>“Summarise what I should study next.”</span>
					</div>
				</div>
			{:else}
				<div class={`agent-thread ${shouldUseThreadPadding ? 'has-thread-padding' : ''}`}>
					<div class={`agent-messages ${shouldUseThreadPadding ? 'has-thread-padding' : ''}`}>
						{#each messages as message (message.id)}
							{@const messageText = resolveMessageText(message)}
							{@const messageHtml =
								message.role === 'assistant' && messageText ? renderMarkdown(messageText) : ''}
							{@const thinkingText = streamingThoughtsByMessageId[message.id] ?? ''}
							{@const messageAttachments = resolveMessageAttachments(message)}
							<div
								class={`agent-message ${message.role === 'user' ? 'is-user' : 'is-agent'}`}
								data-message-id={message.id}
							>
								<span class="sr-only">
									{message.role === 'user' ? 'You' : 'Spark AI Agent'}
								</span>
								{#if messageAttachments.length > 0}
									<div
										class={`message-attachments ${message.role === 'user' ? 'is-user' : 'is-agent'}`}
									>
										{#each messageAttachments as attachment, index (index)}
											{@const file = attachment.file}
											{@const name = resolveAttachmentName(file)}
											{@const isImage = isImageType(file.contentType, name)}
											{@const isPdf = isPdfType(file.contentType, name)}
											{@const fileUrl = resolveAttachmentDownloadUrl(conversationId, file.id)}
											{@const sizeLabel = formatBytes(file.sizeBytes)}
											{@const tooltip = `${name} • ${sizeLabel}`}
											<div
												class="message-attachment-wrap"
												use:tooltipAction={tooltip}
											>
												<div class={`message-attachment ${isImage ? 'is-image' : 'is-file'}`}>
													{#if isImage && fileUrl}
														<a href={fileUrl} target="_blank" rel="noreferrer">
															<img src={fileUrl} alt={name} loading="lazy" />
														</a>
													{:else}
														<a
															class="message-attachment__doc"
															href={fileUrl ?? undefined}
															target={fileUrl ? '_blank' : undefined}
															rel="noreferrer"
														>
															<span class="message-attachment__icon">
																{isPdf ? 'PDF' : 'DOC'}
															</span>
															<span class="message-attachment__name">{name}</span>
															{#if isPdf}
																<span class="message-attachment__size">{sizeLabel}</span>
															{/if}
														</a>
													{/if}
												</div>
											</div>
										{/each}
									</div>
								{/if}
								{#if message.role === 'assistant'}
									<div class="message-bubble">
										{#if thinkingText}
											<div class="message-thinking">
												<p class="message-thinking__label">Thinking</p>
												<div class="message-thinking__body">{thinkingText}</div>
											</div>
										{/if}
										{#if messageHtml}
											<div class="message-markdown markdown">{@html messageHtml}</div>
										{:else if !thinkingText}
											<p class="message-placeholder">…</p>
										{/if}
									</div>
								{:else if messageText}
									<div class="message-bubble">
										<p class="message-plain">{messageText}</p>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<div class="agent-composer" bind:this={composerRef}>
				<div class="composer-stack">
					<div class="composer-card">
						<input
							class="sr-only"
							type="file"
							multiple
							accept="image/*,application/pdf"
							bind:this={attachmentInputRef}
							onchange={handleFileInputChange}
						/>
						<input
							class="sr-only"
							type="file"
							accept="image/*"
							capture="environment"
							bind:this={photoInputRef}
							onchange={handleFileInputChange}
						/>
						{#if attachments.length > 0}
							<div class="composer-attachments" role="list">
								{#each attachments as attachment (attachment.localId)}
									{@const isImage = isImageType(attachment.contentType, attachment.filename)}
									{@const isPdf = isPdfType(attachment.contentType, attachment.filename)}
									{@const previewUrl =
										attachment.previewUrl ??
										resolveAttachmentDownloadUrl(conversationId, attachment.id)}
									{@const sizeLabel = formatBytes(attachment.sizeBytes)}
									{@const tooltip = `${attachment.filename} • ${sizeLabel}`}
									<div class="attachment-card-wrap" use:tooltipAction={tooltip}>
										<div
											class={`attachment-card ${isImage ? 'is-image' : 'is-file'} ${attachment.status}`}
											role="listitem"
										>
											{#if isImage && previewUrl}
												<img src={previewUrl} alt={attachment.filename} loading="lazy" />
											{:else if isPdf}
												<div class="attachment-doc">
													<span class="attachment-doc__icon">PDF</span>
													<span class="attachment-doc__name">{attachment.filename}</span>
													<span class="attachment-doc__size">{sizeLabel}</span>
												</div>
											{:else}
												<div class="attachment-doc">
													<span class="attachment-doc__icon">FILE</span>
													<span class="attachment-doc__name">{attachment.filename}</span>
												</div>
											{/if}
											{#if attachment.status === 'uploading'}
												<div class="attachment-status" aria-label="Uploading">
													<span class="attachment-spinner" aria-hidden="true"></span>
												</div>
											{:else}
												<button
													class="attachment-remove"
													type="button"
													aria-label="Remove attachment"
													onclick={() => void removeAttachment(attachment)}
												>
													<span class="attachment-remove__glyph" aria-hidden="true">×</span>
												</button>
											{/if}
											{#if attachment.status === 'failed'}
												<div class="attachment-error">Upload failed</div>
											{/if}
										</div>
									</div>
								{/each}
							</div>
						{/if}
						{#if attachmentError}
							<div class="composer-attachment-error" role="status">
								{attachmentError}
							</div>
						{/if}
						<div class={`composer-field ${isComposerExpanded ? 'is-expanded' : ''}`}>
							<DropdownMenu.Root>
								<DropdownMenu.Trigger
									class="composer-btn composer-attach composer-leading"
									type="button"
									aria-label="Attach"
									disabled={sending}
								>
									<Plus class="composer-icon" />
								</DropdownMenu.Trigger>
								<DropdownMenu.Content class="composer-menu" sideOffset={12} align="start">
									<DropdownMenu.Item
										class="composer-menu__item"
										onSelect={handleAttachmentSelect}
										disabled={sending}
									>
										<span class="composer-menu__icon" aria-hidden="true">
											<svg
												width="18"
												height="18"
												viewBox="0 0 24 24"
												fill="none"
												xmlns="http://www.w3.org/2000/svg"
												class="composer-menu__paperclip"
											>
												<path
													d="M10 9V15C10 16.1046 10.8954 17 12 17V17C13.1046 17 14 16.1046 14 15V7C14 4.79086 12.2091 3 10 3V3C7.79086 3 6 4.79086 6 7V15C6 18.3137 8.68629 21 12 21V21C15.3137 21 18 18.3137 18 15V8"
													stroke="currentColor"
												></path>
											</svg>
										</span>
										<span>Add photos &amp; files</span>
										{#if attachmentShortcutLabel}
											<DropdownMenu.Shortcut>{attachmentShortcutLabel}</DropdownMenu.Shortcut>
										{/if}
									</DropdownMenu.Item>
									{#if canTakePhoto}
										<DropdownMenu.Separator />
										<DropdownMenu.Item
											class="composer-menu__item"
											onSelect={handleTakePhotoSelect}
											disabled={sending}
										>
											<span class="composer-menu__icon" aria-hidden="true">
												<Camera class="composer-icon" />
											</span>
											<span>Take photo</span>
										</DropdownMenu.Item>
									{/if}
								</DropdownMenu.Content>
							</DropdownMenu.Root>
							<div class="composer-input">
								<ChatInput
									bind:value={draft}
									placeholder="Ask anything"
									ariaLabel="Message Spark AI Agent"
									maxLines={6}
									maxChars={1200}
									disabled={sending}
									variant="chat"
									inputClass="composer-textarea"
									submitMode={isMobileDevice ? 'modEnter' : 'enter'}
									onInput={({ value, isExpanded }) => {
										composerExpanded = isExpanded ?? value.includes('\n');
									}}
									onSubmit={() => void sendMessage()}
								/>
							</div>
							<div class="composer-trailing">
								<button
									class="composer-btn composer-mic"
									type="button"
									aria-label="Voice input"
									disabled={sending}
								>
									<Mic class="composer-icon" />
								</button>
								<button
									class="composer-btn composer-send"
									type="button"
									aria-label="Send message"
									onclick={() => void sendMessage()}
									disabled={!canSend}
								>
									{#if hasPendingUploads || sending}
										<span class="composer-spinner" aria-hidden="true"></span>
									{:else}
										<ArrowUp class="composer-icon" />
									{/if}
								</button>
							</div>
							<div class="composer-spacer" aria-hidden="true"></div>
						</div>
					</div>
				</div>
			</div>
			<div
				class={`attachment-tooltip ${tooltipState.visible ? 'is-visible' : ''}`}
				style={`--tooltip-x:${tooltipState.x}px; --tooltip-y:${tooltipState.y}px;`}
				role="tooltip"
				aria-hidden={!tooltipState.visible}
			>
				{tooltipState.text}
			</div>
		</div>
	</div>
</section>

<style>
	.agent-shell {
		width: min(780px, 92vw);
		margin: 0 auto;
		padding: clamp(1.5rem, 3vw, 2.5rem) 0 1rem;
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
		gap: clamp(1.5rem, 3vw, 2.4rem);
		--spark-composer-offset: 6rem;
		--chat-surface: color-mix(in srgb, var(--app-content-bg, #ffffff) 82%, transparent);
		--chat-border: color-mix(
			in srgb,
			var(--app-content-border, rgba(148, 163, 184, 0.3)) 75%,
			transparent
		);
		--chat-user-bg: color-mix(in srgb, var(--app-content-bg, #ffffff) 70%, rgba(15, 23, 42, 0.06));
		--chat-user-border: color-mix(
			in srgb,
			var(--app-content-border, rgba(148, 163, 184, 0.35)) 70%,
			transparent
		);
		--chat-send-bg: var(--foreground);
		--chat-send-fg: var(--background);
		--code-bg: color-mix(in srgb, var(--app-content-bg, #ffffff) 86%, rgba(15, 23, 42, 0.04));
		--code-border: color-mix(
			in srgb,
			var(--app-content-border, rgba(148, 163, 184, 0.35)) 70%,
			transparent
		);
		--code-header-bg: color-mix(
			in srgb,
			var(--app-content-bg, #ffffff) 80%,
			rgba(15, 23, 42, 0.08)
		);
		--code-text: var(--text-primary, var(--foreground));
		--code-muted: var(--text-secondary, rgba(30, 41, 59, 0.7));
		--code-keyword: #2563eb;
		--code-string: #16a34a;
		--code-number: #ea580c;
		--code-function: #0f766e;
		--code-type: #b45309;
	}

	.agent-shell.has-thread {
		padding-top: clamp(1rem, 2.5vw, 1.6rem);
		gap: clamp(1rem, 2.5vw, 1.8rem);
	}

	:global(:root:not([data-theme='light']) .agent-shell),
	:global([data-theme='dark'] .agent-shell),
	:global(.dark .agent-shell) {
		--chat-surface: color-mix(in srgb, rgba(15, 23, 42, 0.92) 75%, transparent);
		--chat-border: rgba(148, 163, 184, 0.3);
		--chat-user-bg: rgba(30, 41, 59, 0.45);
		--chat-user-border: rgba(148, 163, 184, 0.3);
		--chat-send-bg: rgba(248, 250, 252, 0.92);
		--chat-send-fg: rgba(15, 23, 42, 0.92);
		--code-bg: color-mix(in srgb, rgba(15, 23, 42, 0.92) 82%, transparent);
		--code-border: rgba(148, 163, 184, 0.3);
		--code-header-bg: rgba(30, 41, 59, 0.65);
		--code-text: rgba(226, 232, 240, 0.98);
		--code-muted: rgba(148, 163, 184, 0.8);
		--code-keyword: #60a5fa;
		--code-string: #4ade80;
		--code-number: #fb923c;
		--code-function: #2dd4bf;
		--code-type: #fbbf24;
	}

	.agent-layout {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
		gap: clamp(1.5rem, 3vw, 2.2rem);
	}

	.agent-shell.has-thread .agent-layout {
		gap: clamp(1rem, 2.5vw, 1.6rem);
	}

	.agent-toolbar {
		display: flex;
		justify-content: flex-end;
	}

	.agent-stream {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
		gap: 2rem;
	}

	.agent-shell.has-thread .agent-stream {
		gap: 1.5rem;
	}

	.agent-error {
		padding: 0.9rem 1.1rem;
		border-radius: 1rem;
		border: 1px solid rgba(239, 68, 68, 0.3);
		background: rgba(239, 68, 68, 0.08);
		color: rgba(185, 28, 28, 0.9);
		font-size: 0.9rem;
	}

	.agent-empty {
		padding: clamp(1.6rem, 3vw, 2.4rem);
		border-radius: 1.5rem;
		border: 1px dashed rgba(148, 163, 184, 0.3);
		background: color-mix(in srgb, var(--app-content-bg, #ffffff) 65%, transparent);
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		text-align: center;
	}

	.agent-empty h2 {
		margin: 0;
		font-size: 1.35rem;
	}

	.agent-empty p {
		margin: 0;
		color: var(--text-secondary, rgba(30, 41, 59, 0.7));
	}

	.agent-empty__examples {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: var(--text-secondary, rgba(30, 41, 59, 0.7));
	}

	.agent-empty__examples span {
		padding: 0.4rem 0.8rem;
		border-radius: 1.75rem;
		border: 1px solid var(--chat-border);
		background: var(--chat-surface);
	}

	.agent-thread {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
		gap: 1.75rem;
		padding-bottom: calc(var(--spark-composer-offset, 6rem) + env(safe-area-inset-bottom, 0px));
	}

	.agent-thread.has-thread-padding {
		min-height: calc(100dvh - var(--spark-composer-offset, 6rem) - 10rem);
	}

	.agent-messages {
		display: flex;
		flex-direction: column;
		gap: 1.4rem;
	}

	.agent-messages.has-thread-padding > .agent-message.is-agent:last-child .message-bubble {
		min-height: max(0px, calc(100dvh - var(--spark-composer-offset, 6rem) - 12rem));
	}

	.agent-message {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		width: 100%;
		align-items: flex-start;
	}

	.agent-message.is-user {
		align-items: flex-end;
		text-align: right;
		padding-left: 1rem;
	}

	.message-bubble {
		padding: 0;
		border-radius: 0;
		border: none;
		background: transparent;
		max-width: min(46rem, 100%);
		width: 100%;
		line-height: 1.7;
		font-size: 1rem;
		color: var(--text-primary, var(--foreground));
	}

	.message-markdown {
		font-size: 0.98rem;
		line-height: 1.65;
	}

	.message-plain {
		margin: 0;
		white-space: pre-wrap;
	}

	.message-attachments {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin-bottom: 0.4rem;
	}

	.message-attachments.is-user {
		justify-content: flex-end;
	}

	.message-attachment-wrap {
		flex: 0 0 auto;
		display: inline-flex;
	}

	.message-attachment {
		flex: 0 0 auto;
		height: 140px;
		border-radius: 1rem;
		border: 1px solid var(--chat-border);
		background: var(--chat-surface);
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		padding: 0.4rem;
	}

	.message-attachment.is-image {
		max-width: 220px;
	}

	.message-attachment.is-file {
		aspect-ratio: 3 / 4;
		width: 110px;
	}

	.message-attachment img {
		height: 100%;
		width: auto;
		max-width: 100%;
		object-fit: contain;
		display: block;
		border-radius: 0.75rem;
	}

	.message-attachment__doc {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		text-decoration: none;
		text-align: center;
		color: inherit;
		font-size: 0.75rem;
	}

	.message-attachment__icon {
		font-size: 0.65rem;
		font-weight: 700;
		padding: 0.25rem 0.5rem;
		border-radius: 0.45rem;
		background: color-mix(in srgb, var(--foreground) 8%, transparent);
		color: var(--foreground);
	}

	.message-attachment__name {
		max-width: 6.5rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-secondary, rgba(30, 41, 59, 0.75));
	}

	.message-attachment__size {
		font-size: 0.65rem;
		color: var(--text-secondary, rgba(30, 41, 59, 0.65));
	}

	.attachment-tooltip {
		position: fixed;
		left: var(--tooltip-x, 0px);
		top: var(--tooltip-y, 0px);
		transform: translate(-50%, calc(-100% - 0.65rem));
		padding: 0.35rem 0.5rem;
		border-radius: 0.5rem;
		background: rgba(15, 23, 42, 0.92);
		color: rgba(248, 250, 252, 0.98);
		font-size: 0.65rem;
		white-space: nowrap;
		max-width: 16rem;
		overflow: hidden;
		text-overflow: ellipsis;
		pointer-events: none;
		z-index: 60;
		opacity: 0;
		transition: opacity 0.12s ease;
	}

	.attachment-tooltip.is-visible {
		opacity: 1;
	}

	.attachment-tooltip::after {
		content: '';
		position: absolute;
		left: 50%;
		top: 100%;
		transform: translateX(-50%);
		border-width: 0.35rem 0.35rem 0;
		border-style: solid;
		border-color: rgba(15, 23, 42, 0.92) transparent transparent;
	}

	:global(.message-markdown > * + *) {
		margin-top: 0.75rem;
	}

	:global(.message-markdown h2),
	:global(.message-markdown h3) {
		margin-top: 1rem;
		margin-bottom: 0.4rem;
		font-size: 1.05rem;
		font-weight: 600;
	}

	:global(.message-markdown p) {
		margin: 0;
	}

	:global(.message-markdown ul),
	:global(.message-markdown ol) {
		padding-left: 1.25rem;
		margin: 0;
		list-style-position: outside;
	}

	:global(.message-markdown ul) {
		list-style-type: disc;
	}

	:global(.message-markdown ol) {
		list-style-type: decimal;
	}

	:global(.message-markdown :not(pre) > code) {
		font-family: 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, monospace;
		font-size: 0.85rem;
		padding: 0.1rem 0.3rem;
		border-radius: 0.3rem;
		background: color-mix(in srgb, currentColor 12%, transparent);
	}

	:global(.message-markdown .code-block) {
		margin: 0.85rem 0;
		border-radius: 0.75rem;
		border: 1px solid var(--code-border);
		background: var(--code-bg);
		overflow: hidden;
		box-shadow: 0 16px 30px -28px rgba(15, 23, 42, 0.25);
	}

	:global(.message-markdown .code-block__header) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.45rem 0.75rem;
		background: var(--code-header-bg);
		border-bottom: 1px solid var(--code-border);
		font-size: 0.7rem;
		letter-spacing: 0.01em;
		text-transform: lowercase;
	}

	:global(.message-markdown .code-block__lang) {
		font-weight: 600;
		color: var(--code-muted);
	}

	:global(.message-markdown .code-block__copy) {
		border: none;
		background: transparent;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 0.5rem;
		border: 1px solid transparent;
		color: var(--code-muted);
		cursor: pointer;
		transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
	}

	:global(.message-markdown .code-block__copy:hover) {
		color: var(--code-text);
		background: color-mix(in srgb, var(--code-border) 55%, transparent);
		border-color: var(--code-border);
	}

	:global(.message-markdown .code-block__copy-icon) {
		width: 1rem;
		height: 1rem;
		stroke: currentColor;
		fill: none;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	:global(.message-markdown .code-block__copy[data-copy-state='copied']) {
		color: var(--code-string);
	}

	:global(.message-markdown .code-block__copy[data-copy-state='error']) {
		color: #ef4444;
	}

	:global(.message-markdown .code-block pre) {
		margin: 0;
		padding: 0.85rem 0.9rem 0.95rem;
		overflow-x: auto;
		background: transparent;
	}

	:global(.message-markdown .code-block pre code) {
		display: block;
		padding: 0;
		font-family: 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, monospace;
		font-size: 0.85rem;
		color: var(--code-text);
	}

	:global(.message-markdown .hljs-comment),
	:global(.message-markdown .hljs-quote) {
		color: var(--code-muted);
		font-style: italic;
	}

	:global(.message-markdown .hljs-keyword),
	:global(.message-markdown .hljs-selector-tag),
	:global(.message-markdown .hljs-literal) {
		color: var(--code-keyword);
		font-weight: 600;
	}

	:global(.message-markdown .hljs-string),
	:global(.message-markdown .hljs-symbol),
	:global(.message-markdown .hljs-template-tag) {
		color: var(--code-string);
	}

	:global(.message-markdown .hljs-number),
	:global(.message-markdown .hljs-regexp),
	:global(.message-markdown .hljs-attr) {
		color: var(--code-number);
	}

	:global(.message-markdown .hljs-title),
	:global(.message-markdown .hljs-function) {
		color: var(--code-function);
	}

	:global(.message-markdown .hljs-type),
	:global(.message-markdown .hljs-built_in),
	:global(.message-markdown .hljs-class) {
		color: var(--code-type);
	}

	.message-thinking {
		border-radius: 0.9rem;
		border: 1px solid color-mix(in srgb, var(--chat-border) 70%, transparent);
		background: color-mix(in srgb, var(--chat-surface) 70%, transparent);
		padding: 0.6rem 0.75rem;
		margin-bottom: 0.75rem;
	}

	.message-thinking__label {
		margin: 0;
		font-size: 0.6rem;
		font-weight: 600;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--text-secondary, rgba(30, 41, 59, 0.65));
	}

	.message-thinking__body {
		margin-top: 0.35rem;
		white-space: pre-wrap;
		font-size: 0.8rem;
		line-height: 1.45;
		color: var(--text-secondary, rgba(30, 41, 59, 0.75));
		max-height: 6.5rem;
		overflow: hidden;
	}

	.agent-message.is-user .message-bubble {
		padding: 0.65rem 1rem;
		border-radius: 1.5rem 1.5rem 0.5rem 1.5rem;
		border: 1px solid var(--chat-user-border);
		background: var(--chat-user-bg);
		width: auto;
		max-width: min(46rem, 100%);
		box-shadow: 0 10px 30px -26px rgba(15, 23, 42, 0.3);
	}

	.message-placeholder {
		opacity: 0.6;
	}

	.agent-composer {
		position: sticky;
		bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
		z-index: 2;
		margin-top: auto;
	}

	@supports (-webkit-touch-callout: none) {
		.agent-composer {
			position: fixed;
			left: 50%;
			transform: translateX(-50%);
			width: min(780px, 92vw);
			margin-top: 0;
			z-index: 12;
		}
	}

	.composer-stack {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.composer-attachments {
		display: flex;
		gap: 0.6rem;
		overflow-x: auto;
		padding: 0.2rem 0.1rem 0.4rem;
		scrollbar-width: thin;
	}

	.attachment-card-wrap {
		flex: 0 0 auto;
		display: inline-flex;
	}

	.composer-attachment-error {
		padding: 0.5rem 0.75rem;
		border-radius: 0.75rem;
		border: 1px solid rgba(239, 68, 68, 0.28);
		background: rgba(239, 68, 68, 0.08);
		color: rgba(185, 28, 28, 0.9);
		font-size: 0.85rem;
	}

	.attachment-card {
		position: relative;
		flex: 0 0 auto;
		height: 96px;
		border-radius: 0.9rem;
		border: 1px solid var(--chat-border);
		background: var(--chat-surface);
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		padding: 0.35rem;
	}

	.attachment-card.is-image {
		min-width: 120px;
		max-width: 180px;
	}

	.attachment-card.is-file {
		aspect-ratio: 3 / 4;
		width: 72px;
	}

	.attachment-card img {
		height: 100%;
		width: auto;
		max-width: 100%;
		object-fit: contain;
		display: block;
		border-radius: 0.6rem;
	}

	.attachment-doc {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		text-align: center;
		padding: 0.35rem;
		font-size: 0.65rem;
		color: var(--text-secondary, rgba(30, 41, 59, 0.7));
	}

	.attachment-doc__icon {
		font-size: 0.6rem;
		font-weight: 700;
		padding: 0.2rem 0.4rem;
		border-radius: 0.4rem;
		background: color-mix(in srgb, var(--foreground) 8%, transparent);
		color: var(--foreground);
	}

	.attachment-doc__name {
		max-width: 6.5rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.attachment-doc__size {
		font-size: 0.6rem;
		color: var(--text-secondary, rgba(30, 41, 59, 0.65));
	}

	.attachment-status {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: color-mix(in srgb, var(--background) 60%, transparent);
		backdrop-filter: blur(4px);
	}

	.attachment-spinner {
		width: 1.4rem;
		height: 1.4rem;
		border-radius: 999px;
		border: 2px solid color-mix(in srgb, var(--foreground) 40%, transparent);
		border-top-color: var(--foreground);
		animation: attachment-spin 0.8s linear infinite;
	}

	.attachment-remove {
		position: absolute;
		top: 0.35rem;
		right: 0.35rem;
		width: 1.35rem;
		height: 1.35rem;
		border-radius: 999px;
		border: none;
		background: color-mix(in srgb, var(--foreground) 16%, transparent);
		color: var(--foreground);
		cursor: pointer;
		display: grid;
		place-items: center;
	}

	.attachment-remove__glyph {
		display: block;
		font-size: 0.95rem;
		line-height: 1;
		transform: translateY(-0.5px);
	}

	.attachment-error {
		position: absolute;
		bottom: 0.3rem;
		left: 0.35rem;
		right: 0.35rem;
		font-size: 0.6rem;
		text-align: center;
		color: rgba(185, 28, 28, 0.9);
	}

	.composer-spinner {
		width: 1.1rem;
		height: 1.1rem;
		border-radius: 999px;
		border: 2px solid color-mix(in srgb, currentColor 40%, transparent);
		border-top-color: currentColor;
		animation: attachment-spin 0.8s linear infinite;
	}

	@keyframes attachment-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.composer-card {
		padding: 0.625rem;
		border-radius: 1.75rem;
		border: 1px solid var(--chat-border);
		background: var(--chat-surface);
		backdrop-filter: blur(16px);
		box-shadow:
			0 18px 45px -32px rgba(15, 23, 42, 0.35),
			inset 0 1px 0 rgba(255, 255, 255, 0.55);
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		overflow: clip;
		background-clip: padding-box;
	}

	.composer-card:focus-within {
		border-color: color-mix(in srgb, var(--text-secondary, rgba(30, 41, 59, 0.6)) 40%, transparent);
		box-shadow:
			0 0 0 3px color-mix(in srgb, var(--ring) 35%, transparent),
			0 18px 45px -32px rgba(15, 23, 42, 0.35),
			inset 0 1px 0 rgba(255, 255, 255, 0.55);
	}

	.composer-field {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		grid-template-areas: 'leading input trailing';
		align-items: center;
		gap: 0.6rem;
	}

	.composer-input {
		grid-area: input;
		min-width: 0;
		display: flex;
		align-items: stretch;
	}

	:global(.composer-textarea) {
		padding: 0.15rem 0.2rem 0.25rem;
		width: 100%;
	}

	.composer-leading {
		grid-area: leading;
	}

	.composer-trailing {
		grid-area: trailing;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.composer-spacer {
		grid-area: spacer;
		display: none;
	}

	.composer-field.is-expanded {
		grid-template-areas:
			'input input input'
			'leading spacer trailing';
		row-gap: 0.45rem;
		align-items: end;
	}

	.composer-field.is-expanded .composer-spacer {
		display: block;
	}

	.composer-field.is-expanded .composer-input {
		padding-bottom: 0.25rem;
	}

	.composer-btn {
		display: grid;
		place-items: center;
		height: 2.25rem;
		width: 2.25rem;
		border-radius: 999px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--text-secondary, rgba(30, 41, 59, 0.6));
		transition:
			transform 0.2s ease,
			background 0.2s ease,
			color 0.2s ease;
	}

	.composer-field.is-expanded .composer-btn {
		align-self: end;
	}

	.composer-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.composer-btn:not(.composer-send):not(:disabled):hover {
		background: rgba(148, 163, 184, 0.18);
		color: var(--text-primary, var(--foreground));
		transform: translateY(-1px);
	}

	.composer-send {
		background: var(--chat-send-bg);
		color: var(--chat-send-fg);
		box-shadow: 0 12px 30px -18px rgba(15, 23, 42, 0.35);
	}

	.composer-send:not(:disabled):hover {
		background: color-mix(in srgb, var(--chat-send-bg) 88%, transparent);
		color: var(--chat-send-fg);
		transform: translateY(-1px) scale(1.02);
	}

	.composer-send:disabled {
		background: color-mix(in srgb, var(--chat-send-bg) 60%, transparent);
		color: color-mix(in srgb, var(--chat-send-fg) 70%, transparent);
	}

	.composer-icon {
		height: 1.05rem;
		width: 1.05rem;
	}

	:global(.composer-menu) {
		min-width: 15.5rem;
		padding: 0.35rem;
		border-radius: 1rem;
	}

	:global(.composer-menu__item) {
		gap: 0.65rem;
		padding: 0.6rem 0.65rem;
		border-radius: 0.75rem;
		font-size: 0.92rem;
	}

	:global(.composer-menu__icon) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 0.6rem;
		background: color-mix(in srgb, var(--text-secondary, rgba(30, 41, 59, 0.6)) 12%, transparent);
		color: var(--text-primary, var(--foreground));
	}

	:global(.composer-menu__paperclip) {
		stroke-width: 2;
		color: var(--text-primary, var(--foreground));
	}
</style>
