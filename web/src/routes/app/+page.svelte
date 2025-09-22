<script lang="ts">
	import { onMount } from 'svelte';
	import {
		ArrowUpRight,
		Camera,
		CheckCircle2,
		FileUp,
		Gauge,
		Lightbulb,
		NotebookPen,
		Repeat2,
		Sparkles,
		Target,
		Timer,
		Upload,
		Wand2
	} from '@lucide/svelte';
	type LucideIconComponent = typeof FileUp;

	type SubjectInsight = {
		id: string;
		name: string;
		color: string;
		accuracy: number;
		completion: number;
		trendLabel: string;
		timeSpent: string;
		focusAreas: string[];
		strengths: string[];
		nextActions: { label: string; detail: string }[];
		reflection: string;
	};

	const subjectInsights: SubjectInsight[] = [
		{
			id: 'maths',
			name: 'Mathematics',
			color: '#38bdf8',
			accuracy: 92,
			completion: 78,
			trendLabel: '+4.2% vs last week',
			timeSpent: '4h 20m this week',
			focusAreas: ['Circle theorems', 'Vector geometry deep dive'],
			strengths: ['Quadratics & functions', 'Simultaneous equations'],
			nextActions: [
				{ label: 'Target drill', detail: '2× circle theorem mixed questions' },
				{ label: 'Stretch goal', detail: 'Attempt 1 vector geometry challenge' }
			],
			reflection: 'Confidence jumped after annotating the exam proof step-by-step.'
		},
		{
			id: 'physics',
			name: 'Physics',
			color: '#a855f7',
			accuracy: 84,
			completion: 65,
			trendLabel: '+2.1% vs last week',
			timeSpent: '3h 05m this week',
			focusAreas: ['Electric circuits comparisons', 'Energy transfer wording'],
			strengths: ['Kinematics graphs', 'Forces vocabulary'],
			nextActions: [
				{ label: 'Coach session', detail: 'Explain circuit reasoning aloud' },
				{ label: 'Quick win', detail: 'Review 6 flashcards on key definitions' }
			],
			reflection: 'Verbalising “why” for current flow helped lock in understanding.'
		},
		{
			id: 'chemistry',
			name: 'Chemistry',
			color: '#f97316',
			accuracy: 88,
			completion: 72,
			trendLabel: 'Stable week',
			timeSpent: '2h 42m this week',
			focusAreas: ['Titration calculations', 'Ionic equations fluency'],
			strengths: ['Periodic trends narrative', 'Energy changes'],
			nextActions: [
				{ label: 'Simulation', detail: 'Balance 3 unfamiliar ionic equations' },
				{ label: 'Confidence boost', detail: 'Teach a friend enthalpy change steps' }
			],
			reflection: 'Worked solutions unlocked the pattern behind cancelling spectator ions.'
		}
	];

	const lensOptions = [
		{
			id: 'subjects',
			label: 'Subject Lens',
			description: 'Spot themes you own and the ones to polish.'
		},
		{
			id: 'timeline',
			label: 'Timeline Lens',
			description: 'Replay your study streak like a reflective journal.'
		},
		{
			id: 'numbers',
			label: 'Numbers Lens',
			description: 'See the metrics, streaks, and predicted performance.'
		}
	] as const;

	type LensId = (typeof lensOptions)[number]['id'];

	const timelineEntries = [
		{
			id: '2024-11-04',
			day: 'Today',
			title: 'Vector geometry clinic',
			highlight: 'Solved 4/5 proofs with visual hints',
			energy: 'High focus',
			reflection:
				'Annotating each transformation reduced mistakes — saved each step as a reusable template.',
			followUp: 'Attempt timed drill on circle theorems tomorrow.',
			tags: ['Deep work', 'Hints used ×2']
		},
		{
			id: '2024-11-03',
			day: 'Yesterday',
			title: 'Circuit reasoning walkthrough',
			highlight: 'Recorded explanation improved clarity score to 87%',
			energy: 'Steady',
			reflection:
				'Narrated the difference between current and potential difference using analogies from class.',
			followUp: 'Generate 3 fresh free-response prompts on resistance networks.',
			tags: ['Speaking practice', 'Audio reflection']
		},
		{
			id: '2024-11-01',
			day: 'Friday',
			title: 'Spaced repetition flashcards',
			highlight: 'Cleared review deck in 7 minutes with 93% recall',
			energy: 'Light lift',
			reflection:
				'Mnemonics for endothermic vs exothermic stuck. Add image cue next session to cement it.',
			followUp: 'Schedule challenge mode for higher difficulty next week.',
			tags: ['Flashcards', 'Fast mode']
		}
	];

	const numericMetrics = [
		{
			id: 'questions',
			label: 'Questions completed',
			value: '312',
			subLabel: '+48 vs last month',
			progress: 78,
			gradient: 'from-sky-500 to-sky-600',
			accent: 'text-sky-500'
		},
		{
			id: 'accuracy',
			label: 'Accuracy this week',
			value: '86%',
			subLabel: '+4% trend',
			progress: 86,
			gradient: 'from-emerald-500 to-emerald-600',
			accent: 'text-emerald-500'
		},
		{
			id: 'streak',
			label: 'Streak',
			value: '16 days',
			subLabel: 'Longest yet',
			progress: 64,
			gradient: 'from-fuchsia-500 to-pink-500',
			accent: 'text-fuchsia-500'
		},
		{
			id: 'prediction',
			label: 'Performance estimate',
			value: 'GCSE Grade 7–8',
			subLabel: 'Confidence: high',
			progress: 72,
			gradient: 'from-amber-500 to-orange-500',
			accent: 'text-amber-500'
		}
	];

	const recommendations = [
		{
			id: 'focus-1',
			title: 'Deepen circle theorem intuition',
			body: 'Use “explain like I am the examiner” prompts to justify each angle. Aim for 2 slow, narrated solutions.',
			tag: 'LLM Coach'
		},
		{
			id: 'focus-2',
			title: 'Blend spaced and free-text sessions',
			body: 'Alternate 8-minute flash runs with 12-minute free responses to balance speed and reasoning stamina.',
			tag: 'Study rhythm'
		},
		{
			id: 'focus-3',
			title: 'Record micro-reflections',
			body: 'End each study burst with a 30-second voice note summarising the biggest “aha” moment.',
			tag: 'You'
		}
	];

	type PreferenceOption = {
		id: string;
		label: string;
		description: string;
		active: boolean;
	};

	let practicePreferences: PreferenceOption[] = [
		{
			id: 'free-text',
			label: 'More free-text explorations',
			description: 'Prioritise prompts that require full written reasoning.',
			active: true
		},
		{
			id: 'spaced',
			label: 'Increase spaced repetition',
			description: 'Inject quick recall decks between long-form exercises.',
			active: true
		},
		{
			id: 'exam-mode',
			label: 'Exam-tempo warmups',
			description: 'Start sessions with a 6-minute timed drill to build pacing.',
			active: false
		}
	];

	function togglePreference(id: string) {
		practicePreferences = practicePreferences.map((pref) =>
			pref.id === id ? { ...pref, active: !pref.active } : pref
		);
	}

	const emptyStateSteps: {
		id: string;
		title: string;
		description: string;
		action: string;
		icon: LucideIconComponent;
	}[] = [
		{
			id: 'capture',
			title: 'Snap or upload your material',
			description:
				'Take a photo or drop in a PDF worksheet. Crisp images help the coach parse every detail.',
			action: 'Upload from device',
			icon: FileUp
		},
		{
			id: 'generate',
			title: 'Get tailored practice instantly',
			description:
				'We craft quizzes that mirror the layout and wording of your worksheet within seconds.',
			action: 'Preview generated set',
			icon: Sparkles
		},
		{
			id: 'iterate',
			title: 'Ask for more or steer the focus',
			description:
				'Request harder variants, more visuals, or spaced repetition loops whenever you need.',
			action: 'Produce another version',
			icon: Wand2
		}
	];

	type QuizOptionState = 'neutral' | 'selected' | 'correct';

	type BaseQuizExperience<Id extends string> = {
		id: Id;
		title: string;
		description: string;
	};

	type MCQExperience = BaseQuizExperience<'mcq'> & {
		question: string;
		options: { label: string; state: QuizOptionState }[];
		feedback: string;
	};

	type FreeResponseExperience = BaseQuizExperience<'free-response'> & {
		prompt: string;
		modelHighlights: string[];
		exemplar: string;
	};

	type FlashcardsExperience = BaseQuizExperience<'flashcards'> & {
		front: string;
		back: string;
		schedule: string;
	};

	type AnnotationExperience = BaseQuizExperience<'annotation'> & {
		scenario: string;
		tools: string[];
		coaching: string;
	};

	type QuizExperience =
		| MCQExperience
		| FreeResponseExperience
		| FlashcardsExperience
		| AnnotationExperience;

	const quizExperiences: QuizExperience[] = [
		{
			id: 'mcq',
			title: 'Adaptive multiple choice',
			description: 'Tight, exam-style options with instant rationale.',
			question:
				'The graph of y = f(x) is transformed to y = f(2x). What change happens to the graph?',
			options: [
				{ label: 'Stretches vertically by scale factor 2', state: 'neutral' },
				{ label: 'Stretches horizontally by scale factor 2', state: 'selected' },
				{ label: 'Compresses horizontally by scale factor 1/2', state: 'correct' },
				{ label: 'Translates 2 units right', state: 'neutral' }
			],
			feedback:
				'Correct answer: compresses horizontally by 1/2. You initially chose option B — great instinct!'
		},
		{
			id: 'free-response',
			title: 'Guided free-response',
			description: 'Write, reflect, then compare against an exemplar answer.',
			prompt:
				'Explain why current stays the same in series but potential difference splits across components.',
			modelHighlights: [
				'Structure is clear',
				'Analogy strengthens explanation',
				'Mention ohmic vs non-ohmic'
			],
			exemplar:
				'In a series circuit the same electrons pass through each component sequentially, so current cannot build up or disappear. Potential difference shares out because each component resists charge flow by a different amount, so the total energy drop matches the supply.'
		},
		{
			id: 'flashcards',
			title: 'Spaced repetition flashcards',
			description: 'Smart scheduling keeps recall sharp without burnout.',
			front: 'State the equation linking energy, charge and potential difference.',
			back: 'Energy transferred (J) = Charge (C) × Potential difference (V).',
			schedule: 'Due again in 3 days · Confidence last time: 4/5'
		},
		{
			id: 'annotation',
			title: 'Interactive annotation',
			description: 'Mark up diagrams directly — perfect for geometry or lab setups.',
			scenario: 'Highlight the equal angles and the shared chord on this circle diagram.',
			tools: ['Highlighter', 'Arrow note', 'Voice note'],
			coaching:
				'The coach suggests annotating the tangent line first, then marking alternate segment angles.'
		}
	];

	let selectedSubject = subjectInsights[0];
	let activeLens: LensId = 'subjects';
	let showEmptyState = false;
	let pace = 65;
	let challenge = 72;
	let theme: 'light' | 'dark' = 'light';

	function setLens(id: LensId) {
		activeLens = id;
	}

	function selectSubject(subject: SubjectInsight) {
		selectedSubject = subject;
	}

	function toggleEmptyState() {
		showEmptyState = !showEmptyState;
	}

	function applyTheme(mode: 'light' | 'dark') {
		if (typeof document === 'undefined') return;
		const root = document.documentElement;
		root.classList.toggle('dark', mode === 'dark');
		root.style.colorScheme = mode;
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('spark-theme', mode);
		}
	}

	function toggleTheme() {
		const next = theme === 'light' ? 'dark' : 'light';
		theme = next;
		applyTheme(next);
	}

	onMount(() => {
		if (typeof document === 'undefined') return;
		const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('spark-theme') : null;
		const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		const initial = stored === 'dark' || (!stored && prefersDark) ? 'dark' : 'light';
		theme = initial;
		applyTheme(initial);
	});
</script>

<svelte:head>
	<title>Learning Studio — Spark</title>
	<meta
		name="description"
		content="A calm, focused workspace to review study progress, surface recommendations, and explore new practice sets."
	/>
</svelte:head>

<main
	class="min-h-screen bg-slate-50 text-slate-900 transition-colors duration-300 dark:bg-slate-950 dark:text-slate-100"
>
	<div class="mx-auto flex max-w-7xl flex-col gap-10 px-4 pt-10 pb-24 sm:px-6 lg:px-8">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div>
				<p class="text-sm font-medium text-slate-500 dark:text-slate-400">Spark Learning Studio</p>
				<h1
					class="mt-1 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl dark:text-white"
				>
					Hi Amina — ready for your next breakthrough?
				</h1>
			</div>
			<div class="flex items-center gap-2">
				<button
					class="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg dark:border-white/10 dark:bg-slate-900 dark:text-slate-200"
					on:click={toggleEmptyState}
				>
					<Repeat2 class="h-4 w-4" />
					{showEmptyState ? 'Show active workspace' : 'Show empty flow'}
				</button>
				<button
					class="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg dark:border-white/10 dark:bg-slate-900 dark:text-slate-200"
					on:click={toggleTheme}
				>
					<span class="relative flex h-5 w-5 items-center justify-center">
						<span
							class="absolute inset-0 rounded-full bg-gradient-to-tr from-slate-900 to-slate-700 opacity-0 transition-opacity dark:opacity-100"
						></span>
						<span
							class="absolute inset-0 rounded-full bg-gradient-to-tr from-amber-300 to-orange-400 opacity-100 transition-opacity dark:opacity-0"
						></span>
					</span>
					{theme === 'dark' ? 'Dark' : 'Light'} mode
				</button>
			</div>
		</div>

		<section
			class="relative overflow-hidden rounded-3xl border border-slate-200/60 bg-gradient-to-br from-white via-slate-50 to-slate-100 p-8 shadow-xl dark:border-white/10 dark:from-slate-900 dark:via-slate-950 dark:to-slate-950"
		>
			<div
				class="absolute inset-x-0 top-0 -z-10 h-56 bg-gradient-to-br from-sky-400/30 via-emerald-400/20 to-fuchsia-400/20 blur-3xl dark:from-sky-500/20 dark:via-emerald-500/20 dark:to-purple-500/20"
			></div>
			<div class="grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
				<div class="flex flex-col justify-between gap-10">
					<div class="space-y-6">
						<div
							class="flex flex-wrap items-center gap-3 text-sm text-slate-500 dark:text-slate-400"
						>
							<span
								class="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/90 px-3 py-1 dark:border-white/10 dark:bg-white/5"
							>
								<Sparkles class="h-3.5 w-3.5 text-sky-500" />
								Weekly focus: Precision + Storytelling
							</span>
							<span
								class="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/90 px-3 py-1 dark:border-white/10 dark:bg-white/5"
							>
								<Timer class="h-3.5 w-3.5 text-emerald-500" />
								Avg. session 18m
							</span>
							<span
								class="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/90 px-3 py-1 dark:border-white/10 dark:bg-white/5"
							>
								<Target class="h-3.5 w-3.5 text-fuchsia-500" />
								Next checkpoint: Mock exam on 12 Nov
							</span>
						</div>
						<h2
							class="text-4xl leading-tight font-semibold text-slate-900 sm:text-5xl dark:text-white"
						>
							Build momentum with personalised practice you can steer.
						</h2>
						<p class="max-w-xl text-lg text-slate-600 dark:text-slate-300">
							Capture any worksheet, surface instant insights, then decide how the AI coach should
							challenge you next. Everything stays calm, organised, and tuned to your goals.
						</p>
						<div class="flex flex-wrap gap-3">
							<button
								class="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/30 transition hover:-translate-y-0.5 hover:shadow-xl dark:bg-white dark:text-slate-900"
							>
								<Upload class="h-4 w-4" />
								Upload new material
							</button>
							<button
								class="inline-flex items-center gap-2 rounded-full border border-slate-300/70 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-lg dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
							>
								<Camera class="h-4 w-4" />
								Capture with camera
							</button>
							<button
								class="inline-flex items-center gap-2 rounded-full border border-transparent bg-gradient-to-r from-sky-500 to-emerald-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/30 transition hover:-translate-y-0.5 hover:shadow-xl"
							>
								<Sparkles class="h-4 w-4" />
								Generate more like this
							</button>
						</div>
					</div>
					<div class="grid gap-4 sm:grid-cols-3">
						<div
							class="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5"
						>
							<p class="text-sm font-medium text-slate-600 dark:text-slate-300">This week</p>
							<p class="mt-1 text-3xl font-semibold text-slate-900 dark:text-white">+28</p>
							<p class="text-sm text-slate-500 dark:text-slate-400">New questions completed</p>
						</div>
						<div
							class="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5"
						>
							<p class="text-sm font-medium text-slate-600 dark:text-slate-300">Average accuracy</p>
							<p class="mt-1 text-3xl font-semibold text-slate-900 dark:text-white">86%</p>
							<p class="text-sm text-slate-500 dark:text-slate-400">Up 4% from last week</p>
						</div>
						<div
							class="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5"
						>
							<p class="text-sm font-medium text-slate-600 dark:text-slate-300">Streak</p>
							<p class="mt-1 text-3xl font-semibold text-slate-900 dark:text-white">16 days</p>
							<p class="text-sm text-slate-500 dark:text-slate-400">Keep it alive for a reward</p>
						</div>
					</div>
				</div>
				<div
					class="relative overflow-hidden rounded-3xl border border-white/70 bg-white/90 p-8 shadow-xl backdrop-blur dark:border-white/10 dark:bg-white/5"
				>
					<div
						class="absolute inset-0 -z-10 bg-gradient-to-br from-slate-900/5 to-slate-900/0 dark:from-white/10"
					></div>
					<p class="text-sm font-medium text-slate-600 dark:text-slate-300">Your trajectory</p>
					<h3 class="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">GCSE Grade 7–8</h3>
					<p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
						Confidence: high · Model recalibrates weekly
					</p>
					<div class="mt-6 grid gap-4 text-sm">
						<div
							class="flex items-center justify-between rounded-2xl bg-slate-900/5 px-4 py-3 dark:bg-white/10"
						>
							<div>
								<p class="font-medium text-slate-700 dark:text-slate-200">Focus mix</p>
								<p class="text-xs text-slate-500 dark:text-slate-400">
									60% reasoning · 40% rapid recall
								</p>
							</div>
							<div class="text-right text-xs text-slate-500 dark:text-slate-400">
								Last adjusted 2 days ago
							</div>
						</div>
						<div
							class="flex items-center justify-between rounded-2xl bg-slate-900/5 px-4 py-3 dark:bg-white/10"
						>
							<div>
								<p class="font-medium text-slate-700 dark:text-slate-200">Session cadence</p>
								<p class="text-xs text-slate-500 dark:text-slate-400">4 sessions · 1h 30m total</p>
							</div>
							<div class="inline-flex items-center gap-1 text-xs font-medium text-emerald-500">
								<ArrowUpRight class="h-3.5 w-3.5" />+12% vs last week
							</div>
						</div>
						<div
							class="flex items-center justify-between rounded-2xl bg-slate-900/5 px-4 py-3 dark:bg-white/10"
						>
							<div>
								<p class="font-medium text-slate-700 dark:text-slate-200">Energy trend</p>
								<p class="text-xs text-slate-500 dark:text-slate-400">
									Most focused on Tue & Thu evenings
								</p>
							</div>
							<div
								class="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-500"
							>
								<Sparkles class="h-3.5 w-3.5" />Flow state spotted
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>

		{#if showEmptyState}
			<section
				class="grid gap-6 rounded-3xl border border-dashed border-slate-300/80 bg-white/90 p-10 text-slate-700 shadow-inner dark:border-white/20 dark:bg-slate-900/80 dark:text-slate-100"
			>
				<div class="flex flex-col gap-4 text-center">
					<h2 class="text-3xl font-semibold">Start by capturing your first worksheet</h2>
					<p class="text-lg text-slate-500 dark:text-slate-300">
						The workspace comes alive the moment you share material. Upload a PDF or snap a quick
						photo — the coach handles the rest.
					</p>
				</div>
				<div class="grid gap-6 md:grid-cols-3">
					{#each emptyStateSteps as step (step.id)}
						<div
							class="flex flex-col gap-4 rounded-2xl border border-slate-200/80 bg-white/95 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-xl dark:border-white/10 dark:bg-white/5"
						>
							<div
								class="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-900 to-slate-700 text-white shadow-lg dark:from-white/20 dark:to-white/10"
							>
								<svelte:component this={step.icon} class="h-5 w-5" />
							</div>
							<div class="space-y-2">
								<h3 class="text-xl font-semibold text-slate-900 dark:text-white">{step.title}</h3>
								<p class="text-sm text-slate-500 dark:text-slate-300">{step.description}</p>
							</div>
							<button
								class="mt-auto inline-flex items-center gap-2 rounded-full border border-slate-300/80 px-4 py-2 text-sm font-medium text-slate-700 transition hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-lg dark:border-white/20 dark:text-slate-100"
							>
								{step.action}
								<ArrowUpRight class="h-4 w-4" />
							</button>
						</div>
					{/each}
				</div>
				<div
					class="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-3 text-sm text-slate-500 dark:text-slate-300"
				>
					<span
						class="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 dark:border-white/20"
					>
						<Upload class="h-4 w-4" /> Upload PDF or photo
					</span>
					<span
						class="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 dark:border-white/20"
					>
						<Sparkles class="h-4 w-4" /> Review generated quiz
					</span>
					<span
						class="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 dark:border-white/20"
					>
						<Repeat2 class="h-4 w-4" /> Produce another version instantly
					</span>
				</div>
			</section>
		{:else}
			<section class="flex flex-col gap-6">
				<div class="flex flex-col gap-2">
					<div class="flex flex-wrap items-center justify-between gap-4">
						<div>
							<h2 class="text-2xl font-semibold text-slate-900 dark:text-white">
								How do you want to look at progress?
							</h2>
							<p class="text-sm text-slate-500 dark:text-slate-400">
								Switch between lenses to change perspective — we keep everything in sync.
							</p>
						</div>
					</div>
					<div class="flex flex-wrap gap-3">
						{#each lensOptions as lens (lens.id)}
							<button
								class={`inline-flex min-w-[180px] flex-1 items-center justify-between gap-2 rounded-2xl border px-4 py-3 text-left text-sm transition focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none ${
									activeLens === lens.id
										? 'border-slate-900 bg-slate-900 text-white shadow-lg dark:border-white dark:bg-white dark:text-slate-900'
										: 'border-slate-200 bg-white text-slate-600 hover:-translate-y-0.5 hover:border-slate-300 hover:text-slate-900 hover:shadow-md dark:border-white/10 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-white/20 dark:hover:text-white'
								}`}
								on:click={() => setLens(lens.id)}
							>
								<div>
									<p class="font-semibold">{lens.label}</p>
									<p class="text-xs opacity-80">{lens.description}</p>
								</div>
								<ArrowUpRight class="h-4 w-4" />
							</button>
						{/each}
					</div>
				</div>

				{#if activeLens === 'subjects'}
					<div class="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
						<div class="grid gap-4 sm:grid-cols-2">
							{#each subjectInsights as subject (subject.id)}
								<button
									class={`group relative overflow-hidden rounded-3xl border px-5 py-6 text-left transition ${
										selectedSubject.id === subject.id
											? 'border-transparent bg-gradient-to-br from-slate-900 to-slate-800 text-white shadow-xl dark:from-white/10 dark:to-white/5'
											: 'border-slate-200 bg-white text-slate-700 hover:-translate-y-1 hover:border-slate-300 hover:shadow-xl dark:border-white/10 dark:bg-slate-900 dark:text-slate-200'
									}`}
									on:click={() => selectSubject(subject)}
								>
									<div class="flex items-center justify-between gap-4">
										<div>
											<p
												class={`text-sm ${
													selectedSubject.id === subject.id
														? 'text-white/80'
														: 'text-slate-500 dark:text-slate-300'
												}`}
											>
												{subject.timeSpent}
											</p>
											<h3
												class={`mt-1 text-xl font-semibold ${
													selectedSubject.id === subject.id
														? 'text-white'
														: 'text-slate-900 dark:text-white'
												}`}
											>
												{subject.name}
											</h3>
										</div>
										<div
											class="relative h-14 w-14 rounded-full border-4 border-white/60 shadow-inner"
											style={`background: conic-gradient(${subject.color} ${subject.accuracy * 3.6}deg, rgba(15,23,42,0.12) ${subject.accuracy * 3.6}deg);`}
										>
											<div
												class={`absolute inset-1 flex items-center justify-center rounded-full text-sm font-semibold ${
													selectedSubject.id === subject.id
														? 'bg-slate-900/90 text-white'
														: 'bg-white text-slate-800 dark:bg-slate-950/80 dark:text-slate-100'
												}`}
											>
												{subject.accuracy}%
											</div>
										</div>
									</div>
									<p
										class={`mt-4 text-sm ${
											selectedSubject.id === subject.id
												? 'text-white/70'
												: 'text-slate-500 dark:text-slate-300'
										}`}
									>
										{subject.trendLabel}
									</p>
									<div class="mt-4 flex flex-wrap gap-2 text-xs">
										{#each subject.focusAreas as focus (focus)}
											<span
												class={`rounded-full border px-3 py-1 ${
													selectedSubject.id === subject.id
														? 'border-white/40 bg-white/20 text-white'
														: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-200'
												}`}
											>
												{focus}
											</span>
										{/each}
									</div>
								</button>
							{/each}
						</div>
						<div
							class="flex h-full flex-col gap-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-lg dark:border-white/10 dark:bg-slate-900"
						>
							<div class="flex items-center justify-between">
								<div>
									<p class="text-sm font-medium text-slate-500 dark:text-slate-400">Deeper look</p>
									<h3 class="text-2xl font-semibold text-slate-900 dark:text-white">
										{selectedSubject.name} mastery snapshot
									</h3>
								</div>
								<div
									class="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500 dark:border-white/10 dark:text-slate-300"
								>
									Updated 2h ago
								</div>
							</div>
							<div class="grid gap-4 md:grid-cols-2">
								<div class="rounded-2xl bg-slate-900/5 p-4 dark:bg-white/10">
									<p class="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-300">
										Strengths
									</p>
									<ul class="mt-2 space-y-1 text-sm">
										{#each selectedSubject.strengths as strength (strength)}
											<li
												class="inline-flex items-start gap-2 rounded-xl bg-white/70 px-3 py-2 text-slate-700 shadow-sm dark:bg-white/10 dark:text-slate-200"
											>
												<CheckCircle2 class="mt-0.5 h-4 w-4 text-emerald-500" />
												<span>{strength}</span>
											</li>
										{/each}
									</ul>
								</div>
								<div class="rounded-2xl bg-slate-900/5 p-4 dark:bg-white/10">
									<p class="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-300">
										Next actions
									</p>
									<ul class="mt-2 space-y-3 text-sm text-slate-600 dark:text-slate-200">
										{#each selectedSubject.nextActions as action (action.label)}
											<li
												class="flex flex-col gap-1 rounded-xl bg-white/80 px-3 py-2 shadow-sm dark:bg-white/10"
											>
												<span
													class="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-300"
													>{action.label}</span
												>
												<span>{action.detail}</span>
											</li>
										{/each}
									</ul>
								</div>
							</div>
							<div
								class="rounded-2xl border border-dashed border-slate-200/80 bg-gradient-to-br from-slate-900/5 to-slate-900/0 p-5 text-sm text-slate-600 dark:border-white/10 dark:from-white/10 dark:text-slate-200"
							>
								<p class="font-medium text-slate-700 dark:text-slate-100">Reflection highlight</p>
								<p class="mt-1 text-slate-600 dark:text-slate-200">{selectedSubject.reflection}</p>
							</div>
						</div>
					</div>
				{:else if activeLens === 'timeline'}
					<div class="grid gap-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
						<div class="space-y-4">
							{#each timelineEntries as entry (entry.id)}
								<article
									class="rounded-3xl border border-slate-200 bg-white p-6 shadow-md transition hover:-translate-y-1 hover:shadow-xl dark:border-white/10 dark:bg-slate-900"
								>
									<div class="flex items-center justify-between">
										<div>
											<p class="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
												{entry.day}
											</p>
											<h3 class="text-xl font-semibold text-slate-900 dark:text-white">
												{entry.title}
											</h3>
										</div>
										<div
											class="inline-flex items-center gap-2 rounded-full bg-slate-900/5 px-3 py-1 text-xs font-medium text-slate-500 dark:bg-white/10 dark:text-slate-300"
										>
											<Timer class="h-4 w-4" />
											{entry.energy}
										</div>
									</div>
									<p class="mt-3 text-sm text-slate-600 dark:text-slate-300">{entry.highlight}</p>
									<p class="mt-4 text-sm text-slate-500 dark:text-slate-300">{entry.reflection}</p>
									<div
										class="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500 dark:text-slate-300"
									>
										<div class="inline-flex items-center gap-2">
											<NotebookPen class="h-4 w-4" />
											{entry.followUp}
										</div>
										<div class="flex flex-wrap gap-2 text-xs">
											{#each entry.tags as tag (tag)}
												<span
													class="rounded-full border border-slate-200 px-3 py-1 dark:border-white/20"
													>{tag}</span
												>
											{/each}
										</div>
									</div>
								</article>
							{/each}
						</div>
						<aside
							class="flex h-full flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-lg dark:border-white/10 dark:bg-slate-900"
						>
							<div>
								<p class="text-sm font-medium text-slate-500 dark:text-slate-400">Tempo controls</p>
								<p class="text-sm text-slate-500 dark:text-slate-300">
									Fine-tune how intense upcoming sessions feel.
								</p>
							</div>
							<div class="space-y-6">
								<div>
									<div
										class="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-300"
									>
										<span>Focus pace</span>
										<span>{pace}%</span>
									</div>
									<input
										class="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-slate-900 dark:bg-white/10"
										max="100"
										min="0"
										type="range"
										bind:value={pace}
									/>
								</div>
								<div>
									<div
										class="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-300"
									>
										<span>Challenge level</span>
										<span>{challenge}%</span>
									</div>
									<input
										class="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-slate-900 dark:bg-white/10"
										max="100"
										min="0"
										type="range"
										bind:value={challenge}
									/>
								</div>
							</div>
							<div
								class="rounded-2xl bg-slate-900/5 p-4 text-sm text-slate-600 dark:bg-white/10 dark:text-slate-200"
							>
								<p class="font-semibold text-slate-700 dark:text-white">Upcoming suggestions</p>
								<ul class="mt-2 space-y-2">
									<li>Tuesday · Challenge: circle theorem timed sprint (12 min)</li>
									<li>Thursday · Free response with voice feedback</li>
									<li>Saturday · Flashcard mix with spaced repetition</li>
								</ul>
							</div>
						</aside>
					</div>
				{:else}
					<div class="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
						<div class="grid gap-4 sm:grid-cols-2">
							{#each numericMetrics as metric (metric.id)}
								<div
									class="rounded-3xl border border-slate-200 bg-white p-6 shadow-md dark:border-white/10 dark:bg-slate-900"
								>
									<p class="text-sm font-medium text-slate-500 dark:text-slate-300">
										{metric.label}
									</p>
									<div class="mt-2 flex items-baseline gap-2">
										<p class="text-3xl font-semibold text-slate-900 dark:text-white">
											{metric.value}
										</p>
										<span class={`text-xs font-medium ${metric.accent}`}>{metric.subLabel}</span>
									</div>
									<div
										class="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-white/10"
									>
										<div
											class={`h-full rounded-full bg-gradient-to-r ${metric.gradient}`}
											style={`width: ${metric.progress}%;`}
										></div>
									</div>
								</div>
							{/each}
						</div>
						<div
							class="flex h-full flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-lg dark:border-white/10 dark:bg-slate-900"
						>
							<div class="flex items-center justify-between">
								<div>
									<p class="text-sm font-medium text-slate-500 dark:text-slate-400">
										Confidence check
									</p>
									<h3 class="text-xl font-semibold text-slate-900 dark:text-white">
										Where the model predicts you land
									</h3>
								</div>
								<Gauge class="h-10 w-10 text-emerald-500" />
							</div>
							<div class="space-y-3 text-sm text-slate-600 dark:text-slate-200">
								<div
									class="flex items-center justify-between rounded-2xl bg-slate-900/5 px-4 py-3 dark:bg-white/10"
								>
									<span>Projected GCSE grade</span>
									<span class="font-semibold text-emerald-500">High 7</span>
								</div>
								<div
									class="flex items-center justify-between rounded-2xl bg-slate-900/5 px-4 py-3 dark:bg-white/10"
								>
									<span>Consistency score</span>
									<span class="font-semibold text-sky-500">88 / 100</span>
								</div>
								<div
									class="flex items-center justify-between rounded-2xl bg-slate-900/5 px-4 py-3 dark:bg-white/10"
								>
									<span>Time-on-task</span>
									<span class="font-semibold">3m 42s / question</span>
								</div>
								<div
									class="rounded-2xl border border-dashed border-slate-300/80 bg-gradient-to-br from-slate-900/5 to-slate-900/0 p-4 dark:border-white/10 dark:from-white/10"
								>
									<p class="font-semibold text-slate-700 dark:text-white">Try this</p>
									<p class="text-sm text-slate-600 dark:text-slate-200">
										Ask the coach: “Generate 2 exam-style vector proofs with minimal hints” to
										tighten precision under pressure.
									</p>
								</div>
							</div>
						</div>
					</div>
				{/if}
			</section>

			<section class="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.85fr)]">
				<div
					class="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg dark:border-white/10 dark:bg-slate-900"
				>
					<div class="flex items-center justify-between">
						<div>
							<p class="text-sm font-medium text-slate-500 dark:text-slate-400">
								AI-guided recommendations
							</p>
							<h3 class="text-2xl font-semibold text-slate-900 dark:text-white">
								Where to invest energy next
							</h3>
						</div>
						<Lightbulb class="h-10 w-10 text-amber-400" />
					</div>
					<div class="mt-6 grid gap-4 md:grid-cols-3">
						{#each recommendations as rec (rec.id)}
							<article
								class="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white/80 p-4 text-sm transition hover:-translate-y-1 hover:border-slate-300 hover:shadow-xl dark:border-white/10 dark:bg-white/5"
							>
								<span
									class="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-500 dark:border-white/10 dark:text-slate-300"
								>
									<Sparkles class="h-3.5 w-3.5" />
									{rec.tag}
								</span>
								<h4 class="text-lg font-semibold text-slate-900 dark:text-white">{rec.title}</h4>
								<p class="text-slate-600 dark:text-slate-300">{rec.body}</p>
							</article>
						{/each}
					</div>
				</div>
				<aside
					class="flex h-full flex-col gap-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-lg dark:border-white/10 dark:bg-slate-900"
				>
					<div>
						<p class="text-sm font-medium text-slate-500 dark:text-slate-400">Tune your practice</p>
						<p class="text-sm text-slate-500 dark:text-slate-300">
							Tell the coach what to emphasise — it updates instantly.
						</p>
					</div>
					<div class="space-y-3">
						{#each practicePreferences as pref (pref.id)}
							<button
								class={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition ${
									pref.active
										? 'border-transparent bg-gradient-to-r from-emerald-500 to-sky-500 text-white shadow-lg'
										: 'border-slate-200 bg-white text-slate-600 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md dark:border-white/10 dark:bg-slate-800 dark:text-slate-200'
								}`}
								on:click={() => togglePreference(pref.id)}
							>
								<div class="flex items-center justify-between gap-2">
									<p class="font-semibold">{pref.label}</p>
									{#if pref.active}
										<span
											class="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-1 text-[11px] font-semibold tracking-wide text-white uppercase"
										>
											<CheckCircle2 class="h-3.5 w-3.5" />
											Active
										</span>
									{:else}
										<span
											class="text-[11px] font-medium tracking-wide text-slate-400 uppercase dark:text-slate-300"
										>
											Tap to emphasise
										</span>
									{/if}
								</div>
								<p
									class={`mt-1 text-xs leading-relaxed ${pref.active ? 'text-white/80' : 'text-slate-500 dark:text-slate-300'}`}
								>
									{pref.description}
								</p>
							</button>
						{/each}
					</div>
					<div
						class="rounded-2xl bg-slate-900/5 p-4 text-sm text-slate-600 dark:bg-white/10 dark:text-slate-200"
					>
						<p class="font-semibold text-slate-700 dark:text-white">Need something different?</p>
						<p class="mt-1">
							Ask for “visual-first hints” or “oral explanation mode” — the coach will adapt
							instantly.
						</p>
					</div>
				</aside>
			</section>

			<section
				class="rounded-3xl border border-slate-200 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-slate-900"
			>
				<div class="flex flex-col gap-2">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div>
							<p class="text-sm font-medium text-slate-500 dark:text-slate-400">
								Practice experiences
							</p>
							<h3 class="text-2xl font-semibold text-slate-900 dark:text-white">
								Preview the different quiz types
							</h3>
						</div>
						<div
							class="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-500 dark:border-white/10 dark:text-slate-300"
						>
							Mix & match within a single session
						</div>
					</div>
					<div class="mt-6 grid gap-6 lg:grid-cols-4">
						{#each quizExperiences as quiz (quiz.id)}
							<article
								class="flex h-full flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-5 text-sm shadow-md transition hover:-translate-y-1 hover:border-slate-300 hover:shadow-xl dark:border-white/10 dark:bg-slate-900"
							>
								<div class="flex items-center justify-between">
									<h4 class="text-lg font-semibold text-slate-900 dark:text-white">{quiz.title}</h4>
									<div
										class="rounded-full bg-slate-900/5 px-3 py-1 text-xs font-medium text-slate-500 dark:bg-white/10 dark:text-slate-300"
									>
										{quiz.description}
									</div>
								</div>
								{#if quiz.id === 'mcq'}
									<div class="space-y-3">
										<p class="text-sm text-slate-600 dark:text-slate-300">{quiz.question}</p>
										<div class="space-y-2">
											{#each quiz.options as option (option.label)}
												<div
													class={`flex items-center justify-between rounded-2xl border px-3 py-2 text-sm ${
														option.state === 'correct'
															? 'border-emerald-400 bg-emerald-500/10 text-emerald-600 dark:border-emerald-400/60 dark:bg-emerald-400/10 dark:text-emerald-200'
															: option.state === 'selected'
																? 'border-amber-400 bg-amber-500/10 text-amber-600 dark:border-amber-300/60 dark:bg-amber-400/10 dark:text-amber-200'
																: 'border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-slate-800 dark:text-slate-200'
													}`}
												>
													<span>{option.label}</span>
													{#if option.state !== 'neutral'}
														<CheckCircle2
															class={`h-4 w-4 ${
																option.state === 'correct' ? 'text-emerald-500' : 'text-amber-500'
															}`}
														/>
													{/if}
												</div>
											{/each}
										</div>
										<p
											class="rounded-2xl bg-slate-900/5 px-3 py-2 text-xs text-slate-500 dark:bg-white/10 dark:text-slate-300"
										>
											{quiz.feedback}
										</p>
									</div>
								{:else if quiz.id === 'free-response'}
									<div class="flex h-full flex-col gap-3">
										<p class="text-sm text-slate-600 dark:text-slate-300">{quiz.prompt}</p>
										<div class="flex flex-wrap gap-2 text-xs">
											{#each quiz.modelHighlights as highlight (highlight)}
												<span
													class="rounded-full border border-emerald-300/70 bg-emerald-500/10 px-3 py-1 text-emerald-600 dark:border-emerald-300/40 dark:text-emerald-200"
												>
													{highlight}
												</span>
											{/each}
										</div>
										<div
											class="grow rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-inner dark:border-white/10 dark:bg-slate-800 dark:text-slate-200"
										>
											<p>{quiz.exemplar}</p>
										</div>
									</div>
								{:else if quiz.id === 'flashcards'}
									<div class="flex h-full flex-col gap-3">
										<div
											class="rounded-2xl border border-slate-200 bg-gradient-to-br from-sky-500/10 to-emerald-500/10 p-4 text-slate-700 shadow-inner dark:border-white/10 dark:text-slate-200"
										>
											<p class="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-300">
												Prompt
											</p>
											<p class="mt-1 text-sm">{quiz.front}</p>
										</div>
										<div
											class="rounded-2xl border border-slate-200 bg-slate-900/5 p-4 text-slate-700 shadow-inner dark:border-white/10 dark:bg-slate-800 dark:text-slate-200"
										>
											<p class="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-300">
												Answer
											</p>
											<p class="mt-1 text-sm">{quiz.back}</p>
										</div>
										<p class="text-xs text-slate-500 dark:text-slate-300">{quiz.schedule}</p>
									</div>
								{:else}
									<div class="flex h-full flex-col gap-3">
										<p class="text-sm text-slate-600 dark:text-slate-300">{quiz.scenario}</p>
										<div class="flex flex-wrap gap-2 text-xs">
											{#each quiz.tools as tool (tool)}
												<span
													class="rounded-full border border-slate-200 px-3 py-1 dark:border-white/20"
													>{tool}</span
												>
											{/each}
										</div>
										<div
											class="rounded-2xl border border-dashed border-slate-300/80 bg-gradient-to-br from-slate-900/5 to-slate-900/0 p-4 text-sm text-slate-600 dark:border-white/10 dark:from-white/10 dark:text-slate-200"
										>
											{quiz.coaching}
										</div>
									</div>
								{/if}
							</article>
						{/each}
					</div>
				</div>
			</section>
		{/if}
	</div>
</main>
