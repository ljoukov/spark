<script lang="ts">
	import { browser } from '$app/environment';
	import { invalidateAll } from '$app/navigation';
	import { getFirebaseApp } from '$lib/utils/firebaseClient';
	import { Sheet as PaperSheet, type SheetFeedbackStateMap } from '@ljoukov/sheet';
	import type {
		PaperSheetAnswers,
		PaperSheetFeedbackAttachment,
		PaperSheetFeedbackThread,
		SparkAgentRunStream,
		SparkGraderWorksheetReport,
		SparkSheetPageState,
		SparkSolveSheetDraft,
		SparkSolveSheetAnswers,
		SparkTutorReviewState
	} from '@spark/schemas';
	import {
		SparkAgentRunStreamSchema,
		SparkGraderRunSchema,
		SparkSheetPageStateSchema,
		SparkAgentWorkspaceFileSchema,
		SparkGraderWorksheetReportSchema,
		SparkSolveSheetAnswersSchema,
		SparkSolveSheetDraftSchema,
		SparkTutorReviewStateSchema,
		SparkTutorSessionSchema
	} from '@spark/schemas';
	import { doc, getFirestore, onSnapshot, type Unsubscribe } from 'firebase/firestore';
	import { getAuth, onIdTokenChanged } from 'firebase/auth';
	import { getContext, onMount, untrack } from 'svelte';
	import { fromStore, type Readable } from 'svelte/store';

	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type ClientUser = NonNullable<PageData['user']> | null;
	type FeedbackRuntimeStatus = 'connecting' | 'thinking' | 'responding';
	type PendingReply = {
		text: string;
		attachments: PaperSheetFeedbackAttachment[];
	};

	const userStore = getContext<Readable<ClientUser> | undefined>('spark:user');
	const userSnapshot = userStore ? fromStore(userStore) : null;
	const user = $derived(userSnapshot?.current ?? data.user ?? null);
	const userId = $derived(user?.uid ?? null);
	const initialRun = untrack(() => data.run);
	const initialDraft = untrack(() => data.draft);
	const initialDraftAnswers = untrack(() => data.draftAnswers);
	const initialReport = untrack(() => data.report);
	const initialReviewState = untrack(
		() => data.interaction?.reviewState ?? data.initialReviewState ?? null
	);
	const initialInteractionSessionId = untrack(() => data.interaction?.id ?? null);
	const initialInteractionWorkspaceId = untrack(() => data.interaction?.workspaceId ?? null);
	const initialActiveTurnAgentId = untrack(() => data.interaction?.activeTurnAgentId ?? null);
	const initialActiveTurnQuestionId = untrack(() => data.interaction?.activeTurnQuestionId ?? null);

	let authReady = $state(false);
	let run = $state<PageData['run']>(initialRun);
	let lastSyncedDataRun = $state<PageData['run']>(initialRun);
	let draft = $state<SparkSolveSheetDraft | null>(initialDraft);
	let draftAnswers = $state<PaperSheetAnswers>(initialDraftAnswers);
	let report = $state<SparkGraderWorksheetReport | null>(initialReport);
	let reviewState = $state<SparkTutorReviewState | null>(initialReviewState);
	let interactionSessionId = $state<string | null>(initialInteractionSessionId);
	let interactionWorkspaceId = $state<string | null>(initialInteractionWorkspaceId);
	let activeTurnAgentId = $state<string | null>(initialActiveTurnAgentId);
	let activeTurnQuestionId = $state<string | null>(initialActiveTurnQuestionId);
	let activeAgentStream = $state<SparkAgentRunStream | null>(null);
	let requestError = $state<string | null>(null);
	let draftSaveError = $state<string | null>(null);
	let savingDraft = $state(false);
	let gradingDraft = $state(false);
	let submittingQuestionIds = $state<Record<string, boolean>>({});
	let pendingReplies = $state<Record<string, PendingReply>>({});
	let draftSaveTimer = $state<ReturnType<typeof setTimeout> | null>(null);
	let lastSavedDraftSignature = $state(JSON.stringify(initialDraftAnswers));
	let artifactRefreshInFlight = $state(false);
	let artifactRefreshAttempts = $state(0);

	const ARTIFACT_REFRESH_MAX_ATTEMPTS = 120;
	const ARTIFACT_REFRESH_MAX_DELAY_MS = 5000;
	const ARTIFACT_REFRESH_REQUEST_TIMEOUT_MS = 4000;

	function resolveSnapshotSheetPhase(
		status: PageData['run']['status'],
		explicitPhase: PageData['run']['sheetPhase'] | undefined
	): PageData['run']['sheetPhase'] {
		if (explicitPhase) {
			return explicitPhase;
		}
		if (report) {
			return 'graded';
		}
		if (draft) {
			return 'solving';
		}
		if (status === 'done') {
			return 'graded';
		}
		return 'grading';
	}

	function encodeWorkspaceFileId(filePath: string): string {
		return encodeURIComponent(filePath);
	}

	function removeQuestionKey<T extends Record<string, unknown>>(value: T, questionId: string): T {
		const { [questionId]: _removed, ...rest } = value;
		return rest as T;
	}

	function cleanupPendingReply(reply: PendingReply | undefined): void {
		if (typeof URL === 'undefined') {
			return;
		}
		for (const attachment of reply?.attachments ?? []) {
			if (attachment.url?.startsWith('blob:')) {
				URL.revokeObjectURL(attachment.url);
			}
		}
	}

	function buildSheetAttachmentUrl(filePath: string, filename: string): string {
		const params = new URLSearchParams({
			path: filePath,
			filename
		});
		return `/api/spark/sheets/${run.id}/attachment?${params.toString()}`;
	}

	function buildAttachmentSignature(attachment: {
		filename: string;
		contentType: string;
		sizeBytes: number;
	}): string {
		return `${attachment.filename}::${attachment.contentType}::${attachment.sizeBytes.toString()}`;
	}

	function parseWorkspaceTextFile(
		filePath: string,
		raw: Record<string, unknown> | undefined
	): string | null {
		if (!raw) {
			return null;
		}
		const parsed = SparkAgentWorkspaceFileSchema.safeParse({
			...raw,
			path: filePath
		});
		if (!parsed.success) {
			return null;
		}
		const file = parsed.data;
		if (!('content' in file) || typeof file.content !== 'string') {
			return null;
		}
		return file.content;
	}

	function applyWorkspaceJson<T>(
		filePath: string,
		raw: Record<string, unknown> | undefined,
		parse: (value: unknown) => T,
		apply: (value: T) => void
	): void {
		const text = parseWorkspaceTextFile(filePath, raw);
		if (!text) {
			return;
		}
		try {
			apply(parse(JSON.parse(text)));
		} catch {
			// Ignore transient partial writes.
		}
	}

	function isDraftGradingInProgress(): boolean {
		if (gradingDraft) {
			return true;
		}
		if (run.sheetPhase !== 'grading') {
			return false;
		}
		return run.status !== 'failed' && run.status !== 'stopped';
	}

	function canEditDraftSheet(): boolean {
		if (!draft) {
			return false;
		}
		if (run.sheetPhase !== 'grading') {
			return true;
		}
		return run.status === 'failed' || run.status === 'stopped';
	}

	function applySheetPageState(next: SparkSheetPageState): void {
		run = next.run;
		if (next.draft) {
			draft = next.draft;
		}
		draftAnswers = next.draftAnswers;
		lastSavedDraftSignature = JSON.stringify(next.draftAnswers);
		draftSaveError = null;
		if (next.report) {
			report = next.report;
		}
		const nextReviewState = next.interaction?.reviewState ?? next.initialReviewState ?? null;
		if (nextReviewState) {
			reviewState = nextReviewState;
		}
		if (next.interaction?.id) {
			interactionSessionId = next.interaction.id;
		}
		if (next.interaction?.workspaceId) {
			interactionWorkspaceId = next.interaction.workspaceId;
		}
		if (next.interaction) {
			activeTurnAgentId = next.interaction.activeTurnAgentId;
			activeTurnQuestionId = next.interaction.activeTurnQuestionId;
		}
		if (next.run.status !== 'executing') {
			gradingDraft = false;
		}
	}

	async function refreshSheetArtifacts(): Promise<void> {
		if (artifactRefreshInFlight) {
			return;
		}
		artifactRefreshInFlight = true;
		const controller = new AbortController();
		const timeout = setTimeout(() => {
			controller.abort();
		}, ARTIFACT_REFRESH_REQUEST_TIMEOUT_MS);
		try {
			const response = await window.fetch(`/api/spark/sheets/${run.id}/state`, {
				headers: {
					accept: 'application/json'
				},
				signal: controller.signal
			});
			if (!response.ok) {
				await invalidateAll();
				return;
			}
			const payload = SparkSheetPageStateSchema.parse(await response.json());
			applySheetPageState(payload);
			if (payload.draft === null && payload.report === null && payload.run.status === 'done') {
				await invalidateAll();
			}
		} catch (error) {
			if (!(error instanceof DOMException && error.name === 'AbortError')) {
				console.warn('Failed to refresh sheet artifacts', error);
			}
			await invalidateAll();
		} finally {
			clearTimeout(timeout);
			artifactRefreshInFlight = false;
		}
	}

	function sameRunTotals(
		left: PageData['run']['totals'],
		right: PageData['run']['totals']
	): boolean {
		if (left === null || right === null) {
			return false;
		}
		return (
			left.awardedMarks === right.awardedMarks &&
			left.maxMarks === right.maxMarks &&
			left.percentage === right.percentage
		);
	}

	function sameRunDisplay(
		left: PageData['run']['display'],
		right: PageData['run']['display']
	): boolean {
		return (
			left.title === right.title &&
			left.subtitle === right.subtitle &&
			left.metaLine === right.metaLine &&
			left.summaryMarkdown === right.summaryMarkdown &&
			left.footer === right.footer
		);
	}

	function sameRunState(
		left: PageData['run'],
		right: PageData['run']
	): boolean {
		return (
			left.id === right.id &&
			left.workspaceId === right.workspaceId &&
			left.status === right.status &&
			left.sheetPhase === right.sheetPhase &&
			left.error === right.error &&
			left.createdAt === right.createdAt &&
			left.updatedAt === right.updatedAt &&
			sameRunDisplay(left.display, right.display) &&
			sameRunTotals(left.totals, right.totals)
		);
	}

	async function persistDraftAnswers(
		answers: PaperSheetAnswers,
		signature: string
	): Promise<boolean> {
		draftAnswers = answers;
		if (signature === lastSavedDraftSignature) {
			draftSaveError = null;
			return true;
		}
		savingDraft = true;
		draftSaveError = null;
		try {
			const response = await fetch(`/api/spark/sheets/${run.id}/draft`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({ answers })
			});
			const payload = (await response.json().catch(() => null)) as
				| { error?: string; issues?: Array<{ message?: string }> }
				| null;
			if (!response.ok) {
				draftSaveError =
					payload?.issues?.[0]?.message ??
					payload?.error ??
					'Unable to save your worksheet answers.';
				return false;
			}
			lastSavedDraftSignature = signature;
			return true;
		} catch {
			draftSaveError = 'Unable to save your worksheet answers.';
			return false;
		} finally {
			savingDraft = false;
		}
	}

	function queueDraftSave(answers: PaperSheetAnswers): void {
		draftAnswers = answers;
		const signature = JSON.stringify(answers);
		if (draftSaveTimer) {
			clearTimeout(draftSaveTimer);
		}
		draftSaveTimer = setTimeout(() => {
			void persistDraftAnswers(answers, signature);
		}, 500);
	}

	async function submitSheetForGrading(answers: PaperSheetAnswers): Promise<boolean> {
		if (!draft) {
			return false;
		}
		if (draftSaveTimer) {
			clearTimeout(draftSaveTimer);
			draftSaveTimer = null;
		}
		const signature = JSON.stringify(answers);
		const saved = await persistDraftAnswers(answers, signature);
		if (!saved) {
			return false;
		}
		gradingDraft = true;
		requestError = null;
		try {
			const response = await fetch(`/api/spark/sheets/${run.id}/grade`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({ answers })
			});
			const payload = (await response.json().catch(() => null)) as
				| { error?: string; issues?: Array<{ message?: string }> }
				| null;
			if (!response.ok) {
				requestError =
					payload?.issues?.[0]?.message ??
					payload?.error ??
					'Unable to start grading for this sheet.';
				gradingDraft = false;
				return false;
			}
			run = {
				...run,
				status: 'executing',
				sheetPhase: 'grading',
				error: null,
				updatedAt: new Date().toISOString()
			};
			return true;
		} catch {
			requestError = 'Unable to start grading for this sheet.';
			gradingDraft = false;
			return false;
		}
	}

	async function submitQuestionReply(questionId: string, draft: string, attachments: File[]): Promise<boolean> {
		if (submittingQuestionIds[questionId] || run.status !== 'done') {
			return false;
		}
		const pendingReply: PendingReply = {
			text: draft,
			attachments: attachments.map((file, index) => ({
				id:
					typeof crypto !== 'undefined' && 'randomUUID' in crypto
						? crypto.randomUUID()
						: `pending-${questionId}-${index.toString()}-${Date.now().toString()}`,
				filename: file.name,
				contentType: file.type || 'application/octet-stream',
				sizeBytes: file.size,
				...(file.type.startsWith('image/') ? { url: URL.createObjectURL(file) } : {})
			}))
		};
		submittingQuestionIds = {
			...submittingQuestionIds,
			[questionId]: true
		};
		pendingReplies = {
			...pendingReplies,
			[questionId]: pendingReply
		};
		activeTurnQuestionId = questionId;
		activeAgentStream = null;
		requestError = null;

		try {
			const formData = new FormData();
			formData.append('action', 'reply');
			formData.append('questionId', questionId);
			formData.append('text', draft);
			for (const attachment of attachments) {
				formData.append('file', attachment);
			}
			const response = await fetch(`/api/spark/sheets/${run.id}/turn`, {
				method: 'POST',
				body: formData
			});

			const payload = (await response.json().catch(() => null)) as
				| {
						error?: string;
						issues?: Array<{ message?: string }>;
						sessionId?: string;
						workspaceId?: string;
				  }
				| null;
			if (!response.ok) {
				requestError =
					payload?.issues?.[0]?.message ??
					payload?.error ??
					'Unable to send your worksheet reply.';
				cleanupPendingReply(pendingReply);
				pendingReplies = removeQuestionKey(pendingReplies, questionId);
				return false;
			} else {
				if (payload?.sessionId) {
					interactionSessionId = payload.sessionId;
				}
				if (payload?.workspaceId) {
					interactionWorkspaceId = payload.workspaceId;
				}
				return true;
			}
		} catch {
			requestError = 'Unable to send your worksheet reply.';
			cleanupPendingReply(pendingReply);
			pendingReplies = removeQuestionKey(pendingReplies, questionId);
			return false;
		} finally {
			submittingQuestionIds = removeQuestionKey(submittingQuestionIds, questionId);
		}
	}

	onMount(() => {
		if (!browser) {
			return;
		}
		try {
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
		} catch (error) {
			console.warn('Failed to initialize sheet auth guard', error);
		}
	});

	$effect(() => {
		if (sameRunState(lastSyncedDataRun, data.run)) {
			return;
		}
		lastSyncedDataRun = data.run;
		run = data.run;
	});

	$effect(() => {
		if (draft !== null) {
			return;
		}
		if (!data.draft) {
			return;
		}
		draft = data.draft;
		draftAnswers = data.draftAnswers;
		lastSavedDraftSignature = JSON.stringify(data.draftAnswers);
		draftSaveError = null;
	});

	$effect(() => {
		if (report !== null) {
			return;
		}
		if (!data.report) {
			return;
		}
		report = data.report;
	});

	$effect(() => {
		if (reviewState !== null) {
			return;
		}
		const nextReviewState = data.interaction?.reviewState ?? data.initialReviewState ?? null;
		if (nextReviewState) {
			reviewState = nextReviewState;
		}
	});

	$effect(() => {
		if (!interactionSessionId && data.interaction?.id) {
			interactionSessionId = data.interaction.id;
		}
		if (!interactionWorkspaceId && data.interaction?.workspaceId) {
			interactionWorkspaceId = data.interaction.workspaceId;
		}
		if (!activeTurnAgentId && data.interaction?.activeTurnAgentId) {
			activeTurnAgentId = data.interaction.activeTurnAgentId;
		}
		if (!activeTurnQuestionId && data.interaction?.activeTurnQuestionId) {
			activeTurnQuestionId = data.interaction.activeTurnQuestionId;
		}
	});

	$effect(() => {
		if (!browser) {
			return;
		}
		const shouldRefreshPendingArtifacts =
			report === null &&
			run.status !== 'failed' &&
			run.status !== 'stopped' &&
			(draft === null || run.sheetPhase === 'grading');
		if (!shouldRefreshPendingArtifacts) {
			artifactRefreshAttempts = 0;
			return;
		}
		if (artifactRefreshAttempts >= ARTIFACT_REFRESH_MAX_ATTEMPTS) {
			return;
		}
		const delayMs =
			artifactRefreshAttempts === 0
				? 0
				: Math.min(ARTIFACT_REFRESH_MAX_DELAY_MS, artifactRefreshAttempts * 500);
		const timer = setTimeout(() => {
			artifactRefreshAttempts += 1;
			void refreshSheetArtifacts();
		}, delayMs);
		return () => {
			clearTimeout(timer);
		};
	});

	$effect(() => {
		if (!browser || !authReady || !userId) {
			return;
		}
		const db = getFirestore(getFirebaseApp());
		const uid = userId;
		const runRef = doc(db, 'spark', uid, 'graderRuns', run.id);
		return onSnapshot(
			runRef,
			(snapshot) => {
				if (!snapshot.exists()) {
					return;
				}
				const parsed = SparkGraderRunSchema.safeParse({
					id: run.id,
					...snapshot.data()
				});
				if (!parsed.success) {
					return;
				}
				const nextSheetPhase = resolveSnapshotSheetPhase(parsed.data.status, parsed.data.sheetPhase);
				run = {
					...run,
					status: parsed.data.status,
					sheetPhase: nextSheetPhase,
					error: parsed.data.error ?? null,
					updatedAt: parsed.data.updatedAt.toISOString()
				};
				if (parsed.data.status !== 'executing') {
					gradingDraft = false;
				}
				const shouldReloadCompletedBuild =
					draft === null && report === null && parsed.data.status === 'done';
				const shouldReloadForReport =
					report === null &&
					parsed.data.status === 'done' &&
					nextSheetPhase === 'graded';
				if (shouldReloadCompletedBuild || shouldReloadForReport) {
					void refreshSheetArtifacts();
				}
			},
			(error) => {
				console.warn('Sheet run subscription failed', error);
			}
		);
	});

	$effect(() => {
		if (!browser || !authReady || !userId) {
			return;
		}
		const db = getFirestore(getFirebaseApp());
		const uid = userId;
		const workspaceId = run.workspaceId;
		const stops: Unsubscribe[] = [];
		const subscribeWorkspaceFile = (
			filePath: string,
			apply: (raw: Record<string, unknown> | undefined) => void
		) => {
			const fileRef = doc(
				db,
				'users',
				uid,
				'workspace',
				workspaceId,
				'files',
				encodeWorkspaceFileId(filePath)
			);
			stops.push(
				onSnapshot(
					fileRef,
					(snapshot) => {
						apply(snapshot.exists() ? (snapshot.data() as Record<string, unknown>) : undefined);
					},
					(error) => {
						console.warn(`Sheet artifact subscription failed (${filePath})`, error);
					}
				)
			);
		};
		subscribeWorkspaceFile(data.artifactPaths.draft, (raw) => {
			applyWorkspaceJson(
				data.artifactPaths.draft,
				raw,
				(value) => SparkSolveSheetDraftSchema.parse(value),
				(value) => {
					draft = value;
					if (run.sheetPhase === 'building') {
						run = {
							...run,
							sheetPhase: 'solving'
						};
					}
				}
			);
		});
		subscribeWorkspaceFile(data.artifactPaths.draftAnswers, (raw) => {
			applyWorkspaceJson(
				data.artifactPaths.draftAnswers,
				raw,
				(value) => SparkSolveSheetAnswersSchema.parse(value),
				(value: SparkSolveSheetAnswers) => {
					draftAnswers = value.answers;
					lastSavedDraftSignature = JSON.stringify(value.answers);
					draftSaveError = null;
				}
			);
		});
		subscribeWorkspaceFile(data.artifactPaths.report, (raw) => {
			applyWorkspaceJson(
				data.artifactPaths.report,
				raw,
				(value) => SparkGraderWorksheetReportSchema.parse(value),
				(_value) => {
					if (report === null) {
						void refreshSheetArtifacts();
					}
				}
			);
		});
		return () => {
			for (const stop of stops) {
				stop();
			}
		};
	});

	$effect(() => {
		if (!browser || !authReady || !userId || !interactionWorkspaceId) {
			return;
		}
		const db = getFirestore(getFirebaseApp());
		const uid = userId;
		const workspaceId = interactionWorkspaceId;
		const stops: Unsubscribe[] = [];
		const subscribeWorkspaceFile = (
			filePath: string,
			apply: (raw: Record<string, unknown> | undefined) => void
		) => {
			const fileRef = doc(
				db,
				'users',
				uid,
				'workspace',
				workspaceId,
				'files',
				encodeWorkspaceFileId(filePath)
			);
			stops.push(
				onSnapshot(
					fileRef,
					(snapshot) => {
						apply(snapshot.exists() ? (snapshot.data() as Record<string, unknown>) : undefined);
					},
					(error) => {
						console.warn(`Sheet workspace file subscription failed (${filePath})`, error);
					}
				)
			);
		};
		subscribeWorkspaceFile('state/review.json', (raw) => {
			applyWorkspaceJson(
				'state/review.json',
				raw,
				(value) => SparkTutorReviewStateSchema.parse(value),
				(value) => {
					reviewState = value;
				}
			);
		});
		subscribeWorkspaceFile('context/report.json', (raw) => {
			applyWorkspaceJson(
				'context/report.json',
				raw,
				(value) => SparkGraderWorksheetReportSchema.parse(value),
				(value) => {
					report = value;
				}
			);
		});
		return () => {
			for (const stop of stops) {
				stop();
			}
		};
	});

	$effect(() => {
		if (!browser || !authReady || !userId || !interactionSessionId) {
			return;
		}
		const db = getFirestore(getFirebaseApp());
		const uid = userId;
		const sessionId = interactionSessionId;
		const sessionRef = doc(db, 'spark', uid, 'tutorSessions', sessionId);
		return onSnapshot(
			sessionRef,
			(snapshot) => {
				if (!snapshot.exists()) {
					return;
				}
				const parsed = SparkTutorSessionSchema.safeParse({
					id: interactionSessionId,
					...snapshot.data()
				});
				if (!parsed.success) {
					return;
				}
				activeTurnAgentId = parsed.data.activeTurnAgentId ?? null;
				activeTurnQuestionId = parsed.data.activeTurnQuestionId ?? null;
			},
			(error) => {
				console.warn('Sheet tutor session subscription failed', error);
			}
		);
	});

	$effect(() => {
		if (!browser || !authReady || !userId || !activeTurnAgentId) {
			activeAgentStream = null;
			return;
		}
		const db = getFirestore(getFirebaseApp());
		const uid = userId;
		const agentId = activeTurnAgentId;
		const logRef = doc(db, 'users', uid, 'agents', agentId, 'logs', 'log');
		return onSnapshot(
			logRef,
			(snapshot) => {
				if (!snapshot.exists()) {
					activeAgentStream = null;
					return;
				}
				const parsed = SparkAgentRunStreamSchema.safeParse(
					(snapshot.data() as Record<string, unknown>).stream
				);
				activeAgentStream = parsed.success ? parsed.data : null;
			},
			(error) => {
				console.warn('Sheet active agent stream subscription failed', error);
			}
		);
	});

	$effect(() => {
		if (!reviewState || Object.keys(pendingReplies).length === 0) {
			return;
		}
		let nextPendingReplies = pendingReplies;
		let changed = false;
		for (const [questionId, pendingReply] of Object.entries(pendingReplies)) {
			const thread = reviewState.threads[questionId];
			const lastStudentMessage =
				thread?.messages.findLast((message) => message.author === 'student') ?? null;
			const lastMessageSignatures = (lastStudentMessage?.attachments ?? []).map(buildAttachmentSignature);
			const pendingSignatures = pendingReply.attachments.map(buildAttachmentSignature);
			if (
				lastStudentMessage?.markdown === pendingReply.text &&
				lastMessageSignatures.length === pendingSignatures.length &&
				lastMessageSignatures.every((signature, index) => signature === pendingSignatures[index])
			) {
				if (!changed) {
					nextPendingReplies = { ...pendingReplies };
					changed = true;
				}
				cleanupPendingReply(pendingReply);
				delete nextPendingReplies[questionId];
			}
		}
		if (changed) {
			pendingReplies = nextPendingReplies;
		}
	});

	const activeRuntimeQuestionId = $derived.by(() => {
		if (activeTurnQuestionId) {
			return activeTurnQuestionId;
		}
		if (reviewState) {
			for (const [questionId, thread] of Object.entries(reviewState.threads)) {
				if (thread.status === 'responding') {
					return questionId;
				}
			}
		}
		const firstPendingQuestionId = Object.keys(submittingQuestionIds)[0];
		return firstPendingQuestionId ?? null;
	});

	const feedbackThreads = $derived.by((): Record<string, PaperSheetFeedbackThread> => {
		const threads: Record<string, PaperSheetFeedbackThread> = {};
		if (!reviewState) {
			return threads;
		}
		for (const [questionId, thread] of Object.entries(reviewState.threads)) {
			const turns: PaperSheetFeedbackThread['turns'] = thread.messages.map((message) => ({
				id: message.id,
				speaker: message.author === 'assistant' ? ('tutor' as const) : ('student' as const),
				text: message.markdown,
				attachments: message.attachments?.map((attachment) => ({
					...attachment,
					...(attachment.filePath
						? { url: buildSheetAttachmentUrl(attachment.filePath, attachment.filename) }
						: {})
				}))
			}));
			const pendingReply = pendingReplies[questionId];
			const lastStudentTurn = turns.findLast((turn) => turn.speaker === 'student') ?? null;
			const lastTurnSignatures = (lastStudentTurn?.attachments ?? []).map(buildAttachmentSignature);
			const pendingSignatures = (pendingReply?.attachments ?? []).map(buildAttachmentSignature);
			const shouldAppendPendingTurn =
				pendingReply !== undefined &&
				(lastStudentTurn?.text !== pendingReply.text ||
					lastTurnSignatures.length !== pendingSignatures.length ||
					lastTurnSignatures.some((signature, index) => signature !== pendingSignatures[index]));
			const status: PaperSheetFeedbackThread['status'] =
				shouldAppendPendingTurn ? 'responding' : thread.status;
			const nextTurns: PaperSheetFeedbackThread['turns'] =
				shouldAppendPendingTurn
					? [
							...turns,
							{
								id: `pending-${questionId}`,
								speaker: 'student',
								text: pendingReply.text,
								attachments: pendingReply.attachments
							}
						]
					: turns;
			threads[questionId] = {
				status,
				turns: nextTurns
			};
		}
		return threads;
	});

	const feedbackRuntimeStatuses = $derived.by((): Record<string, FeedbackRuntimeStatus> => {
		if (!activeRuntimeQuestionId) {
			return {};
		}

		const questionId = activeRuntimeQuestionId;
		const runtimeStatus: FeedbackRuntimeStatus | null = activeAgentStream?.assistant?.trim()
			? 'responding'
			: activeAgentStream?.thoughts?.trim()
				? 'thinking'
				: activeTurnAgentId ||
					  reviewState?.threads[questionId]?.status === 'responding' ||
					  submittingQuestionIds[questionId]
					? 'connecting'
					: null;

		if (!runtimeStatus) {
			return {};
		}

		return {
			[questionId]: runtimeStatus
		};
	});

	const feedbackThinking = $derived.by(() =>
		activeRuntimeQuestionId && activeAgentStream?.thoughts?.trim()
			? { [activeRuntimeQuestionId]: activeAgentStream.thoughts }
			: {}
	);

	const feedbackAssistantDrafts = $derived.by(() =>
		activeRuntimeQuestionId && activeAgentStream?.assistant?.trim()
			? { [activeRuntimeQuestionId]: activeAgentStream.assistant }
			: {}
	);

	const feedbackState = $derived.by((): SheetFeedbackStateMap => {
		const next: SheetFeedbackStateMap = {};

		for (const [questionId, sending] of Object.entries(submittingQuestionIds)) {
			if (sending) {
				next[questionId] = {
					...(next[questionId] ?? {}),
					sending: true
				};
			}
		}

		for (const [questionId, runtimeStatus] of Object.entries(feedbackRuntimeStatuses)) {
			next[questionId] = {
				...(next[questionId] ?? {}),
				runtimeStatus
			};
		}

		for (const [questionId, thinkingText] of Object.entries(feedbackThinking)) {
			next[questionId] = {
				...(next[questionId] ?? {}),
				thinkingText
			};
		}

		for (const [questionId, assistantDraftText] of Object.entries(feedbackAssistantDrafts)) {
			next[questionId] = {
				...(next[questionId] ?? {}),
				assistantDraftText
			};
		}

		return next;
	});

</script>

<svelte:head>
	<title>Spark · {run.display.title}</title>
</svelte:head>

<section class="sheet-page">
	{#if requestError}
		<p class="action-error" role="alert">{requestError}</p>
	{/if}
	{#if draftSaveError}
		<p class="action-error" role="alert">{draftSaveError}</p>
	{/if}
	{#if savingDraft && !draftSaveError}
		<p class="status-note">Saving answers…</p>
	{/if}

	{#if report && reviewState}
		<div class="sheet-shell">
			<PaperSheet
				document={reviewState.sheet}
				answers={reviewState.answers}
				review={reviewState.review}
				mode="review"
				allowReplies={run.status === 'done'}
				footerLabel={null}
				feedbackThreads={feedbackThreads}
				feedbackState={feedbackState}
				onReply={(questionId, payload) => {
					return submitQuestionReply(questionId, payload.text, payload.attachments);
				}}
			/>
		</div>
	{:else if draft}
		<div class="sheet-shell">
			<PaperSheet
				document={draft.sheet}
				answers={draftAnswers}
				mode={canEditDraftSheet() ? 'interactive' : 'readonly'}
				grading={isDraftGradingInProgress()}
				footerLabel={null}
				gradeLabel={run.status === 'failed' || run.status === 'stopped' ? 'Grade Again' : 'Grade'}
				onAnswersChange={(answers) => {
					queueDraftSave(answers);
				}}
				onGrade={(answers) => {
					return submitSheetForGrading(answers);
				}}
			/>
		</div>
	{:else}
		<section class="pending-card">
			<h2>
				{run.status === 'failed'
					? run.sheetPhase === 'building'
						? 'This sheet failed to generate'
						: 'This sheet failed to grade'
					: run.status === 'stopped'
						? run.sheetPhase === 'building'
							? 'This sheet was stopped before generation finished'
							: 'This sheet was stopped before grading finished'
						: run.sheetPhase === 'building'
							? run.status === 'created'
								? 'This sheet is queued for generation'
								: 'This sheet is still being prepared'
							: run.status === 'created'
								? 'This sheet is queued for grading'
								: 'This sheet is still being graded'}
			</h2>
			<p>
				{run.error ??
					(run.sheetPhase === 'building'
						? run.status === 'created'
							? 'Spark has queued this worksheet and will publish the sheet once generation starts.'
							: 'The worksheet draft has not been published yet. This page will refresh once it is ready.'
						: run.status === 'created'
							? 'Spark has queued this worksheet for grading and will switch into feedback mode once the report is ready.'
							: 'The graded worksheet artifact has not been published yet. This page will refresh once grading finishes.')}
			</p>
		</section>
	{/if}
</section>

<style lang="postcss">
	.sheet-page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: min(100%, 1024px);
		max-width: 1024px;
		margin: 0 auto;
	}

	.pending-card {
		border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
		border-radius: 1rem;
		background: color-mix(in srgb, var(--card) 95%, transparent);
		padding: 1rem;
	}

	.pending-card p {
		margin: 0.75rem 0 0;
	}

	.action-error {
		margin: 0;
		color: var(--destructive);
		font-weight: 600;
	}

	.status-note {
		margin: 0;
		color: color-mix(in srgb, var(--foreground) 72%, transparent);
		font-weight: 600;
	}

	.sheet-shell {
		overflow: auto;
		padding-bottom: 0.2rem;
	}

	.pending-card h2 {
		margin: 0;
	}

	@media (min-width: 1025px) {
		.sheet-page {
			padding-block: 1.25rem 2rem;
		}
	}
</style>
