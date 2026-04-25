<script lang="ts">
	import { goto } from '$app/navigation';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import BookOpenIcon from '@lucide/svelte/icons/book-open';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import SaveIcon from '@lucide/svelte/icons/save';
	import UserRoundIcon from '@lucide/svelte/icons/user-round';
	import XIcon from '@lucide/svelte/icons/x';
	import { untrack } from 'svelte';
	import { MarkdownContent } from '$lib/components/markdown';
	import { resolvePaperSheetSubjectTheme } from '@spark/schemas';
	import {
		DIAGNOSTIC_COUNTRIES,
		DIAGNOSTIC_TOPICS,
		getDiagnosticLevelOptions,
		getDiagnosticSubjectDetailOptions,
		resolveDiagnosticLevelLabel,
		type DiagnosticCountry,
		type DiagnosticStartMode,
		type DiagnosticTopic
	} from '$lib/diagnostic/options';
	import type { PageData } from './$types';

	type Profile = PageData['profile'];
	type Subject = Profile['subjects'][number];
	type Diagnostic = PageData['diagnostics'][number];
	type DiagnosticSheet = Diagnostic['sheets'][number];
	type SubjectInput = {
		id?: string;
		topic: DiagnosticTopic;
		country: DiagnosticCountry;
		schoolYear: string;
		course: string;
		board: string;
		notes: string;
	};

	let { data }: { data: PageData } = $props();
	const initialProfile = untrack(() => data.profile);
	let profile = $state<Profile>(initialProfile);
	let diagnostics = $state<Diagnostic[]>(untrack(() => data.diagnostics));
	let birthYearInput = $state(initialProfile.birthYear?.toString() ?? '');
	let profileError = $state<string | null>(null);
	let requestError = $state<string | null>(null);
	let profileSaving = $state(false);
	let startingSubjectId = $state<string | null>(null);
	let startingMode = $state<DiagnosticStartMode | null>(null);
	let editingSubjectId = $state<string | null>(null);
	let showSubjectForm = $state(initialProfile.subjects.length === 0);
	let subjectForm = $state<SubjectInput>(
		createEmptySubjectForm(initialProfile.subjects[0]?.country ?? 'UK')
	);

	const currentYear = new Date().getFullYear();
	const birthYearValue = $derived(Number.parseInt(birthYearInput, 10));
	const birthYearValid = $derived(
		Number.isInteger(birthYearValue) && birthYearValue >= 1990 && birthYearValue <= currentYear
	);
	const levelOptions = $derived(getDiagnosticLevelOptions(subjectForm.country));
	const schoolYearLabel = $derived(resolveDiagnosticLevelLabel(subjectForm.country));
	const detailOptions = $derived(
		getDiagnosticSubjectDetailOptions(subjectForm.country, subjectForm.topic)
	);

	$effect(() => {
		if (!levelOptions.includes(subjectForm.schoolYear)) {
			subjectForm.schoolYear = levelOptions[0] ?? subjectForm.schoolYear;
		}
		const currentCourse = untrack(() => subjectForm.course);
		const currentBoard = untrack(() => subjectForm.board);
		if (!detailOptions.courses.includes(currentCourse)) {
			subjectForm.course = detailOptions.courses[0] ?? currentCourse;
		}
		if (!detailOptions.boards.includes(currentBoard)) {
			subjectForm.board = detailOptions.boards[0] ?? currentBoard;
		}
	});

	function createEmptySubjectForm(country: DiagnosticCountry): SubjectInput {
		const topic: DiagnosticTopic = 'olympiad_math';
		const level = getDiagnosticLevelOptions(country)[5] ?? getDiagnosticLevelOptions(country)[0] ?? 'Year 8';
		const details = getDiagnosticSubjectDetailOptions(country, topic);
		return {
			topic,
			country,
			schoolYear: level,
			course: details.courses[0] ?? 'School course',
			board: details.boards[0] ?? 'School set',
			notes: ''
		};
	}

	function subjectToInput(subject: Subject): SubjectInput {
		return {
			id: subject.id,
			topic: subject.topic,
			country: subject.country,
			schoolYear: subject.schoolYear,
			course: subject.course,
			board: subject.board,
			notes: subject.notes
		};
	}

	function normalizeSubjectInput(subject: Subject | SubjectInput): SubjectInput {
		return {
			id: subject.id,
			topic: subject.topic,
			country: subject.country,
			schoolYear: subject.schoolYear,
			course: subject.course.trim(),
			board: subject.board.trim(),
			notes: subject.notes.trim()
		};
	}

	function subjectThemeStyle(subject: Subject): string {
		const theme = resolvePaperSheetSubjectTheme({
			label: `${subject.subjectLabel} ${subject.topicLabel} ${subject.course}`
		});
		return [
			`--subject-color: ${theme.color}`,
			`--subject-accent: ${theme.accent}`,
			`--subject-light: ${theme.light}`,
			`--subject-border: ${theme.border}`
		].join('; ');
	}

	function formatDate(value: string | null): string {
		if (!value) {
			return '';
		}
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) {
			return value;
		}
		return date.toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	function formatPercent(value: number): string {
		const rounded = Math.round(value * 10) / 10;
		return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
	}

	function conciseText(value: string, maxWords: number): string {
		const normalized = value.replace(/\s+/g, ' ').trim();
		if (!normalized) {
			return '';
		}
		const [firstSentence] = normalized.split(/(?<=[.!?])\s+/u);
		const source = firstSentence && firstSentence.length > 0 ? firstSentence : normalized;
		const words = source.split(' ');
		if (words.length <= maxWords) {
			return source;
		}
		return `${words.slice(0, maxWords).join(' ').replace(/[.,;:!?]+$/u, '')}.`;
	}

	function conciseList(items: string[], maxItems = 2, maxWords = 16): string[] {
		return items
			.map((item) => conciseText(item, maxWords))
			.filter((item) => item.length > 0)
			.slice(0, maxItems);
	}

	function diagnosticScoreLine(value: Diagnostic): string {
		const gradedSheets = value.sheets.filter((sheet) => sheet.grading);
		const totalScore = gradedSheets.reduce((sum, sheet) => sum + (sheet.grading?.totalScore ?? 0), 0);
		const maxScore = gradedSheets.reduce((sum, sheet) => sum + (sheet.grading?.maxScore ?? 0), 0);
		if (maxScore <= 0) {
			return 'Three sheets completed.';
		}
		return `${gradedSheets.length.toString()} sheets completed: ${totalScore.toString()}/${maxScore.toString()} marks overall.`;
	}

	function buildResultsMarkdown(value: Diagnostic): string {
		const results = value.results;
		if (!results) {
			return 'Generating diagnostic results. Refresh in a moment if this does not update.';
		}
		const keep = conciseList(results.strengths, 1, 14)[0] ?? 'Completed the diagnostic sequence.';
		const focus =
			conciseList(results.focusAreas, 1, 16)[0] ??
			'Review the marked questions before increasing difficulty.';
		const next =
			conciseList(results.nextSteps, 1, 18)[0] ??
			(conciseText(results.recommendedPath, 16) || 'Continue with a progress diagnostic.');
		return [
			`### ${conciseText(results.levelBand, 10)}`,
			`**Evidence:** ${diagnosticScoreLine(value)}`,
			`**Keep:** ${keep}`,
			`**Focus:** ${focus}`,
			`**Next:** ${next}`
		].join('\n\n');
	}

	function matchesSubject(diagnostic: Diagnostic, subject: Subject): boolean {
		if (diagnostic.subjectId) {
			return diagnostic.subjectId === subject.id;
		}
		return (
			diagnostic.topic === subject.topic &&
			diagnostic.country === subject.country &&
			diagnostic.schoolYear === subject.schoolYear &&
			(!diagnostic.subjectCourse || diagnostic.subjectCourse === subject.course)
		);
	}

	function subjectDiagnostics(subject: Subject): Diagnostic[] {
		return diagnostics.filter((diagnostic) => matchesSubject(diagnostic, subject));
	}

	function activeDiagnosticForSubject(subject: Subject): Diagnostic | null {
		return subjectDiagnostics(subject).find((diagnostic) => diagnostic.status === 'in_progress') ?? null;
	}

	function latestCompletedDiagnosticForSubject(subject: Subject): Diagnostic | null {
		return subjectDiagnostics(subject).find((diagnostic) => diagnostic.status === 'complete') ?? null;
	}

	function latestDiagnosticForSubject(subject: Subject): Diagnostic | null {
		return subjectDiagnostics(subject)[0] ?? null;
	}

	function findSheet(diagnostic: Diagnostic, index: number): DiagnosticSheet | null {
		return diagnostic.sheets.find((sheet) => sheet.index === index) ?? null;
	}

	function resolveSheetState(diagnostic: Diagnostic, sheet: DiagnosticSheet | null, index: number): string {
		if (!sheet) {
			return 'locked';
		}
		if (sheet.runId) {
			return 'graded';
		}
		if (diagnostic.status === 'in_progress' && diagnostic.currentSheetIndex === index) {
			return 'current';
		}
		return 'locked';
	}

	function resolveSheetHref(diagnostic: Diagnostic, sheet: DiagnosticSheet | null, index: number): string | null {
		const state = resolveSheetState(diagnostic, sheet, index);
		if (state === 'graded' && sheet?.runId) {
			return `/spark/sheets/${sheet.runId}`;
		}
		if (state === 'current') {
			return `/spark/diagnostic/${diagnostic.id}`;
		}
		return null;
	}

	function resolveSheetStatusLabel(diagnostic: Diagnostic, sheet: DiagnosticSheet | null, index: number): string {
		const state = resolveSheetState(diagnostic, sheet, index);
		if (state === 'graded') {
			return 'Graded';
		}
		if (state === 'current') {
			return 'Ready';
		}
		return 'Waiting';
	}

	function openNewSubjectForm(): void {
		editingSubjectId = null;
		subjectForm = createEmptySubjectForm(profile.subjects[0]?.country ?? 'UK');
		showSubjectForm = true;
		profileError = null;
	}

	function openEditSubjectForm(subject: Subject): void {
		editingSubjectId = subject.id;
		subjectForm = subjectToInput(subject);
		showSubjectForm = true;
		profileError = null;
	}

	async function saveProfile(subjects: Array<Subject | SubjectInput>): Promise<Profile | null> {
		profileError = null;
		if (!birthYearValid) {
			profileError = `Enter a year of birth between 1990 and ${currentYear.toString()}.`;
			return null;
		}
		const normalizedSubjects = subjects.map(normalizeSubjectInput);
		if (normalizedSubjects.some((subject) => !subject.course || !subject.board)) {
			profileError = 'Every subject needs a course/detail and board or syllabus.';
			return null;
		}
		profileSaving = true;
		try {
			const response = await fetch('/api/spark/diagnostic/profile', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					birthYear: birthYearValue,
					subjects: normalizedSubjects
				})
			});
			const payload = (await response.json().catch(() => null)) as {
				profile?: Profile;
				error?: string;
			} | null;
			if (!response.ok || !payload?.profile) {
				throw new Error(payload?.error ?? 'diagnostic_profile_save_failed');
			}
			profile = payload.profile;
			birthYearInput = payload.profile.birthYear?.toString() ?? birthYearInput;
			return payload.profile;
		} catch (error) {
			console.error('[diagnostic] profile save failed', error);
			profileError = 'Profile could not be saved. Try again.';
			return null;
		} finally {
			profileSaving = false;
		}
	}

	async function saveYearOfBirth(): Promise<void> {
		await saveProfile(profile.subjects);
	}

	async function saveSubject(): Promise<void> {
		const nextSubject = normalizeSubjectInput(subjectForm);
		const nextSubjects = editingSubjectId
			? profile.subjects.map((subject) => (subject.id === editingSubjectId ? nextSubject : subject))
			: [...profile.subjects, nextSubject];
		const saved = await saveProfile(nextSubjects);
		if (saved) {
			showSubjectForm = false;
			editingSubjectId = null;
			subjectForm = createEmptySubjectForm(saved.subjects[0]?.country ?? 'UK');
		}
	}

	async function startDiagnostic(subject: Subject, mode: DiagnosticStartMode): Promise<void> {
		if (startingSubjectId) {
			return;
		}
		if (profile.birthYear !== birthYearValue) {
			const saved = await saveProfile(profile.subjects);
			if (!saved) {
				return;
			}
		}
		startingSubjectId = subject.id;
		startingMode = mode;
		requestError = null;
		try {
			const response = await fetch('/api/spark/diagnostic/start', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					subjectId: subject.id,
					mode
				})
			});
			const payload = (await response.json().catch(() => null)) as {
				diagnostic?: Diagnostic;
				error?: string;
			} | null;
			if (!response.ok || !payload?.diagnostic) {
				throw new Error(payload?.error ?? 'diagnostic_start_failed');
			}
			diagnostics = [payload.diagnostic, ...diagnostics.filter((item) => item.id !== payload.diagnostic?.id)];
			await goto(`/spark/diagnostic/${payload.diagnostic.id}`);
		} catch (error) {
			console.error('[diagnostic] start request failed', error);
			requestError = 'Diagnostic could not start. Try again.';
		} finally {
			startingSubjectId = null;
			startingMode = null;
		}
	}
</script>

<svelte:head>
	<title>Spark · Diagnostic</title>
</svelte:head>

<section class="diagnostic-page">
	<header class="diagnostic-header">
		<div>
			<p class="eyebrow">Diagnostic</p>
			<h1>Subject diagnostics</h1>
			<p class="subtitle">
				Keep a small learner profile, add subjects with course details, then run a diagnostic for
				each subject independently.
			</p>
		</div>
		<a class="back-button" href="/spark">Back to chat</a>
	</header>

	{#if profileError || requestError}
		<div class="diagnostic-error" role="alert">{profileError ?? requestError}</div>
	{/if}

	<section class="profile-panel" aria-label="Learner profile">
		<div class="profile-panel__title">
			<span class="profile-icon" aria-hidden="true">
				<UserRoundIcon size={19} />
			</span>
			<div>
				<p class="eyebrow">Profile</p>
				<h2>Learner details</h2>
			</div>
		</div>
		<div class="profile-panel__controls">
			<label class="field compact" for="birth-year">
				<span>Year of birth</span>
				<input
					id="birth-year"
					type="number"
					min="1990"
					max={currentYear}
					inputmode="numeric"
					bind:value={birthYearInput}
				/>
			</label>
			<button
				class="secondary-button"
				type="button"
				onclick={() => void saveYearOfBirth()}
				disabled={profileSaving}
			>
				{#if profileSaving}
					<Loader2Icon class="spin" size={17} />
					<span>Saving</span>
				{:else}
					<SaveIcon size={17} />
					<span>Save profile</span>
				{/if}
			</button>
		</div>
		<p class="profile-note">
			Used across all subjects. Subject, course, and board can be added or edited below.
		</p>
	</section>

	<section class="subjects-panel" aria-label="Diagnostic subjects">
		<div class="section-heading">
			<div>
				<p class="eyebrow">Subjects</p>
				<h2>{profile.subjects.length === 0 ? 'Add the first subject' : 'Diagnostic subjects'}</h2>
			</div>
			{#if !showSubjectForm}
				<button class="primary-button" type="button" onclick={openNewSubjectForm}>
					<PlusIcon size={17} />
					<span>Add subject</span>
				</button>
			{/if}
		</div>

		{#if showSubjectForm}
			<form
				class="subject-form"
				aria-label={editingSubjectId ? 'Edit diagnostic subject' : 'Add diagnostic subject'}
				onsubmit={(event) => {
					event.preventDefault();
					void saveSubject();
				}}
			>
				<div class="subject-form__heading">
					<div>
						<h3>{editingSubjectId ? 'Edit subject' : 'New subject'}</h3>
						<p>Country first, then subject, then the local school stage and syllabus details.</p>
					</div>
					<button
						class="icon-button"
						type="button"
						aria-label="Close subject form"
						onclick={() => {
							showSubjectForm = false;
							editingSubjectId = null;
						}}
					>
						<XIcon size={18} />
					</button>
				</div>
				<div class="setup-grid">
					<label class="field" for="subject-country">
						<span>Country</span>
						<select id="subject-country" bind:value={subjectForm.country}>
							{#each DIAGNOSTIC_COUNTRIES as country}
								<option value={country.value}>{country.label}</option>
							{/each}
						</select>
					</label>
					<label class="field" for="subject-topic">
						<span>Subject</span>
						<select id="subject-topic" bind:value={subjectForm.topic}>
							{#each DIAGNOSTIC_TOPICS as topic}
								<option value={topic.value}>{topic.label}</option>
							{/each}
						</select>
					</label>
					<label class="field" for="subject-year">
						<span>{schoolYearLabel}</span>
						<select id="subject-year" bind:value={subjectForm.schoolYear}>
							{#each levelOptions as schoolYear}
								<option value={schoolYear}>{schoolYear}</option>
							{/each}
						</select>
					</label>
					<label class="field" for="subject-course">
						<span>Course or detail</span>
						<input
							id="subject-course"
							list="subject-course-options"
							bind:value={subjectForm.course}
							placeholder="GCSE Triple Science Physics"
						/>
						<datalist id="subject-course-options">
							{#each detailOptions.courses as course}
								<option value={course}></option>
							{/each}
						</datalist>
					</label>
					<label class="field" for="subject-board">
						<span>Board or syllabus</span>
						<input
							id="subject-board"
							list="subject-board-options"
							bind:value={subjectForm.board}
							placeholder="AQA"
						/>
						<datalist id="subject-board-options">
							{#each detailOptions.boards as board}
								<option value={board}></option>
							{/each}
						</datalist>
					</label>
					<label class="field" for="subject-notes">
						<span>Notes</span>
						<input
							id="subject-notes"
							bind:value={subjectForm.notes}
							placeholder="Optional class set, exam date, or target"
						/>
					</label>
				</div>
				<div class="setup-actions">
					<button class="primary-button" type="submit" disabled={profileSaving}>
						{#if profileSaving}
							<Loader2Icon class="spin" size={17} />
							<span>Saving</span>
						{:else}
							<SaveIcon size={17} />
							<span>{editingSubjectId ? 'Save subject' : 'Add subject'}</span>
						{/if}
					</button>
				</div>
			</form>
		{/if}

		{#if profile.subjects.length === 0}
			<section class="empty-panel">
				<BookOpenIcon size={24} />
				<div>
					<h3>No subjects yet</h3>
					<p>Add a subject such as GCSE Triple Science Physics, AQA, then start its diagnostic.</p>
				</div>
			</section>
		{:else}
			<div class="subject-grid">
				{#each profile.subjects as subject (subject.id)}
					{@const activeDiagnostic = activeDiagnosticForSubject(subject)}
					{@const completedDiagnostic = latestCompletedDiagnosticForSubject(subject)}
					{@const latestDiagnostic = latestDiagnosticForSubject(subject)}
					<article class="subject-card" style={subjectThemeStyle(subject)}>
						<header class="subject-card__header">
							<div class="subject-badge" aria-hidden="true">
								{subject.subjectLabel.slice(0, 1)}
							</div>
							<div>
								<p class="subject-card__eyebrow">{subject.topicLabel}</p>
								<h3>{subject.course}</h3>
								<p>{subject.countryLabel} · {subject.schoolYear} · {subject.board}</p>
							</div>
						</header>

						{#if subject.notes}
							<p class="subject-notes">{subject.notes}</p>
						{/if}

						<div class="subject-status">
							{#if activeDiagnostic}
								<span class="status-dot" data-state="current"></span>
								<div>
									<strong>Diagnostic in progress</strong>
									<p>
										{activeDiagnostic.sheets.filter((sheet) => sheet.runId).length} of 3 sheets graded.
										Open sheet {activeDiagnostic.currentSheetIndex}.
									</p>
								</div>
							{:else if completedDiagnostic}
								<span class="status-dot" data-state="complete"></span>
								<div>
									<strong>Completed {formatDate(completedDiagnostic.completedAt)}</strong>
									<div class="diagnostic-report">
										<MarkdownContent markdown={buildResultsMarkdown(completedDiagnostic)} />
									</div>
								</div>
							{:else}
								<span class="status-dot" data-state="empty"></span>
								<div>
									<strong>No diagnostic yet</strong>
									<p>The first sheet will start from this subject profile.</p>
								</div>
							{/if}
						</div>

						<div class="subject-actions">
							<button
								class="secondary-button"
								type="button"
								onclick={() => openEditSubjectForm(subject)}
							>
								<PencilIcon size={16} />
								<span>Edit</span>
							</button>
							{#if activeDiagnostic}
								<a class="primary-button" href={`/spark/diagnostic/${activeDiagnostic.id}`}>
									<span>Continue</span>
									<ArrowRightIcon size={16} />
								</a>
							{:else if completedDiagnostic}
								<button
									class="secondary-button"
									type="button"
									onclick={() => void startDiagnostic(subject, 'fresh')}
									disabled={startingSubjectId !== null}
								>
									{#if startingSubjectId === subject.id && startingMode === 'fresh'}
										<Loader2Icon class="spin" size={16} />
										<span>Starting</span>
									{:else}
										<RotateCcwIcon size={16} />
										<span>Retake</span>
									{/if}
								</button>
								<button
									class="primary-button"
									type="button"
									onclick={() => void startDiagnostic(subject, 'progress')}
									disabled={startingSubjectId !== null}
								>
									{#if startingSubjectId === subject.id && startingMode === 'progress'}
										<Loader2Icon class="spin" size={16} />
										<span>Generating</span>
									{:else}
										<span>Progress further</span>
										<ArrowRightIcon size={16} />
									{/if}
								</button>
							{:else}
								<button
									class="primary-button"
									type="button"
									onclick={() => void startDiagnostic(subject, 'fresh')}
									disabled={startingSubjectId !== null}
								>
									{#if startingSubjectId === subject.id}
										<Loader2Icon class="spin" size={16} />
										<span>Generating</span>
									{:else}
										<span>Start diagnostic</span>
										<ArrowRightIcon size={16} />
									{/if}
								</button>
							{/if}
						</div>

						{#if latestDiagnostic}
							<div class="sheet-strip" aria-label={`${subject.subjectLabel} diagnostic sheets`}>
								{#each [1, 2, 3] as index}
									{@const sheet = findSheet(latestDiagnostic, index)}
									{@const href = resolveSheetHref(latestDiagnostic, sheet, index)}
									<svelte:element
										this={href ? 'a' : 'div'}
										href={href ?? undefined}
										class="mini-sheet"
										data-state={resolveSheetState(latestDiagnostic, sheet, index)}
									>
										<span class="mini-sheet__label">Sheet {index}</span>
										<strong>
											{#if sheet?.grading}
												{sheet.grading.totalScore}/{sheet.grading.maxScore}
											{:else}
												-
											{/if}
										</strong>
										<small>
											{#if sheet?.grading}
												{formatPercent(sheet.grading.percentage)}
											{:else}
												{resolveSheetStatusLabel(latestDiagnostic, sheet, index)}
											{/if}
										</small>
										<FileTextIcon size={14} />
									</svelte:element>
								{/each}
							</div>
						{/if}
					</article>
				{/each}
			</div>
		{/if}
	</section>
</section>

<style lang="postcss">
	.diagnostic-page {
		--diagnostic-sheet-color: #3f3bb5;
		--diagnostic-sheet-accent: #5856d6;
		--diagnostic-sheet-light: #eeeeff;
		--diagnostic-sheet-border: #c1c0f6;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: min(100%, 1024px);
		max-width: 1024px;
		margin: 0 auto 3rem;
		padding-top: 1.5rem;
		color: var(--foreground);
	}

	.diagnostic-header,
	.profile-panel,
	.section-heading,
	.subject-card__header,
	.subject-actions,
	.setup-actions {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
	}

	.diagnostic-header,
	.section-heading {
		justify-content: space-between;
	}

	.eyebrow {
		margin: 0 0 0.2rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.78rem;
		font-weight: 750;
		color: color-mix(in srgb, var(--diagnostic-sheet-color) 78%, var(--foreground));
	}

	h1,
	h2,
	h3,
	p {
		margin-top: 0;
	}

	h1 {
		margin-bottom: 0.35rem;
		font-size: 2rem;
		line-height: 1;
	}

	h2 {
		margin-bottom: 0.25rem;
		font-size: 1.35rem;
		line-height: 1.16;
	}

	h3 {
		margin-bottom: 0.25rem;
		font-size: 1rem;
		line-height: 1.2;
	}

	.subtitle,
	.profile-note,
	.subject-form__heading p,
	.empty-panel p,
	.subject-card__header p,
	.subject-status p,
	.subject-notes {
		margin-bottom: 0;
		color: color-mix(in srgb, var(--foreground) 68%, transparent);
	}

	.subtitle {
		max-width: 50rem;
	}

	.back-button,
	.primary-button,
	.secondary-button,
	.icon-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		border-radius: 8px;
		text-decoration: none;
		font-weight: 780;
		white-space: nowrap;
	}

	.back-button,
	.primary-button,
	.secondary-button {
		min-height: 2.45rem;
		padding: 0.55rem 0.85rem;
	}

	.back-button,
	.secondary-button,
	.icon-button {
		border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
		background: color-mix(in srgb, var(--card) 95%, transparent);
		color: inherit;
	}

	.primary-button {
		border: 1px solid color-mix(in srgb, var(--diagnostic-sheet-color) 34%, transparent);
		background: color-mix(in srgb, var(--background) 88%, var(--diagnostic-sheet-light) 72%);
		color: color-mix(in srgb, var(--diagnostic-sheet-color) 86%, var(--foreground));
		cursor: pointer;
	}

	.primary-button:hover,
	.primary-button:focus-visible {
		background: color-mix(in srgb, var(--diagnostic-sheet-light) 78%, var(--background));
	}

	.subject-card .primary-button {
		border-color: var(--subject-color, var(--diagnostic-sheet-color));
		background: var(--subject-color, var(--diagnostic-sheet-color));
		color: #ffffff;
	}

	.subject-card .primary-button:hover,
	.subject-card .primary-button:focus-visible {
		background: color-mix(in srgb, var(--subject-color, var(--diagnostic-sheet-color)) 88%, #000);
	}

	button.primary-button,
	button.secondary-button,
	button.icon-button {
		cursor: pointer;
	}

	.primary-button:disabled,
	.secondary-button:disabled {
		opacity: 0.58;
		cursor: not-allowed;
	}

	.icon-button {
		width: 2.25rem;
		height: 2.25rem;
		padding: 0;
		border-radius: 999px;
	}

	:global(.spin) {
		animation: spin 0.9s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.diagnostic-error {
		padding: 0.85rem 1rem;
		border: 1px solid #f0a7a7;
		border-radius: 8px;
		background: #fff1f2;
		color: #8a1f2d;
		font-weight: 700;
	}

	.profile-panel,
	.subjects-panel,
	.subject-form,
	.subject-card,
	.empty-panel {
		border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
		border-radius: 8px;
		background: color-mix(in srgb, var(--card) 96%, transparent);
		box-shadow: 0 14px 36px rgba(15, 23, 42, 0.07);
	}

	.profile-panel {
		display: grid;
		grid-template-columns: auto auto minmax(0, 24rem);
		align-items: center;
		justify-content: flex-start;
		padding: 1rem;
	}

	.profile-panel__title,
	.profile-panel__controls {
		display: flex;
		gap: 0.75rem;
	}

	.profile-panel__title {
		align-items: center;
	}

	.profile-panel__controls {
		align-items: flex-end;
	}

	.profile-icon,
	.subject-badge,
	.status-dot {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
	}

	.profile-icon {
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 999px;
		background: var(--diagnostic-sheet-light);
		color: var(--diagnostic-sheet-color);
	}

	.profile-note {
		grid-column: 2 / 4;
		max-width: 24rem;
		font-size: 0.9rem;
	}

	.subjects-panel {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem;
	}

	.subject-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem;
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--diagnostic-sheet-light) 68%, transparent),
				transparent 42%
			),
			color-mix(in srgb, var(--card) 98%, transparent);
	}

	.subject-form__heading {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
	}

	.setup-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.8rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.field.compact {
		min-width: 9rem;
	}

	.field span {
		font-size: 0.82rem;
		font-weight: 760;
		color: color-mix(in srgb, var(--foreground) 75%, transparent);
	}

	.field select,
	.field input {
		width: 100%;
		min-height: 2.55rem;
		border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
		border-radius: 8px;
		background: var(--background);
		color: var(--foreground);
		padding: 0.5rem 0.65rem;
		font: inherit;
	}

	.setup-actions {
		justify-content: flex-end;
		flex-wrap: wrap;
	}

	.empty-panel {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 1rem;
		color: color-mix(in srgb, var(--foreground) 74%, transparent);
	}

	.subject-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1rem;
	}

	.subject-card {
		--subject-color: var(--diagnostic-sheet-color);
		--subject-accent: var(--diagnostic-sheet-accent);
		--subject-light: var(--diagnostic-sheet-light);
		--subject-border: var(--diagnostic-sheet-border);
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		padding: 1rem;
		border-color: color-mix(in srgb, var(--subject-border) 72%, var(--border));
		font-family: Georgia, 'Times New Roman', serif;
	}

	.subject-badge {
		width: 2.8rem;
		height: 2.8rem;
		border-radius: 8px;
		border: 1px solid color-mix(in srgb, var(--subject-border) 72%, transparent);
		background: var(--subject-light);
		color: var(--subject-color);
		font-weight: 850;
	}

	.subject-card__eyebrow {
		margin: 0 0 0.18rem;
		color: color-mix(in srgb, var(--subject-color) 78%, var(--foreground));
		font-family:
			ui-sans-serif,
			system-ui,
			sans-serif;
		font-size: 0.75rem;
		font-weight: 820;
	}

	.subject-notes {
		border-left: 3px solid color-mix(in srgb, var(--subject-accent) 74%, var(--subject-color));
		padding-left: 0.7rem;
		font-size: 0.9rem;
	}

	.subject-status {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.7rem;
		align-items: flex-start;
		padding: 0.85rem;
		border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
		border-radius: 8px;
		background: color-mix(in srgb, var(--background) 74%, transparent);
	}

	.status-dot {
		width: 0.85rem;
		height: 0.85rem;
		margin-top: 0.25rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--foreground) 24%, transparent);
	}

	.status-dot[data-state='current'] {
		background: #d6a11e;
	}

	.status-dot[data-state='complete'] {
		background: var(--paper-review-correct-border, #22a66e);
	}

	.diagnostic-report {
		margin-top: 0.55rem;
		line-height: 1.42;
		--markdown-heading: color-mix(in srgb, var(--subject-color) 82%, var(--foreground));
		--markdown-strong: color-mix(in srgb, var(--subject-color) 76%, var(--foreground));
		--markdown-quote-border: var(--subject-color);
	}

	:global(.diagnostic-report .markdown-content > * + *) {
		margin-top: 0.42rem;
	}

	:global(.diagnostic-report .markdown-content h3) {
		margin: 0 0 0.25rem;
		font-size: 0.98rem;
		font-weight: 820;
	}

	:global(.diagnostic-report .markdown-content p),
	:global(.diagnostic-report .markdown-content li),
	:global(.diagnostic-report .markdown-content blockquote) {
		color: color-mix(in srgb, var(--foreground) 74%, transparent);
	}

	.subject-actions {
		font-family:
			ui-sans-serif,
			system-ui,
			sans-serif;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.sheet-strip {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.65rem;
	}

	.mini-sheet {
		min-height: 6.4rem;
		display: grid;
		grid-template-rows: auto 1fr auto;
		gap: 0.2rem;
		padding: 0.65rem;
		border: 1px solid color-mix(in srgb, var(--subject-border) 58%, var(--border));
		border-radius: 8px;
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--subject-light) 82%, var(--card)) 0%,
				var(--card) 70%
			),
			var(--card);
		color: inherit;
		font-family: Georgia, 'Times New Roman', serif;
		text-decoration: none;
	}

	.mini-sheet[data-state='locked'] {
		opacity: 0.62;
		background: color-mix(in srgb, var(--card) 96%, transparent);
	}

	.mini-sheet[data-state='current'] {
		border-color: color-mix(in srgb, var(--subject-color) 64%, var(--border));
	}

	.mini-sheet:hover {
		transform: translateY(-1px);
	}

	.mini-sheet__label,
	.mini-sheet small {
		color: color-mix(in srgb, var(--foreground) 62%, transparent);
		font-size: 0.76rem;
	}

	.mini-sheet strong {
		align-self: center;
		font-size: 1.05rem;
	}

	:global(.mini-sheet svg) {
		justify-self: end;
		color: color-mix(in srgb, var(--subject-color) 70%, var(--foreground));
	}

	:global([data-theme='dark'] .subject-badge),
	:global(:root:not([data-theme='light']) .subject-badge),
	:global([data-theme='dark'] .mini-sheet),
	:global(:root:not([data-theme='light']) .mini-sheet) {
		background: color-mix(in srgb, var(--background) 90%, var(--subject-color) 10%);
	}

	@media (max-width: 980px) {
		.profile-panel,
		.diagnostic-header,
		.section-heading {
			align-items: stretch;
		}

		.diagnostic-header,
		.section-heading {
			flex-direction: column;
		}

		.profile-panel {
			grid-template-columns: 1fr;
		}

		.profile-panel__title {
			align-items: flex-start;
		}

		.profile-panel__controls {
			align-items: flex-end;
		}

		.profile-note {
			grid-column: 1;
			max-width: none;
		}

		.setup-grid,
		.subject-grid {
			grid-template-columns: 1fr;
		}

		.back-button {
			align-self: flex-start;
		}
	}

	@media (max-width: 640px) {
		.diagnostic-page {
			width: min(100% - 1rem, 1024px);
			padding-top: 1rem;
		}

		.profile-panel__controls,
		.subject-actions,
		.setup-actions {
			flex-direction: column;
			align-items: stretch;
		}

		.primary-button,
		.secondary-button {
			width: 100%;
			white-space: normal;
		}

		.sheet-strip {
			grid-template-columns: 1fr;
		}
	}
</style>
