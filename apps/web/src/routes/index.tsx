import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export const Route = createFileRoute("/")({
	component: HomeComponent,
});
const PROBLEM_SET_FILES = ["ai.json", "eu.json", "resources.json"] as const;

const QUESTIONS_PER_ROUND = 10;
const SECONDS_PER_QUESTION = 45;
const TOTAL_MS = SECONDS_PER_QUESTION * 1000;
const LOW_TIME_SECONDS = 10;
const TICK_MS = 100;

type RawQuestion = {
	id: number;
	question: string;
	options: Record<string, string>;
	answer: string;
	explanation?: string;
	source: string;
};

type ProblemSet = {
	title: string;
	format?: string;
	question_count?: number;
	sources: string[];
	categories: { category: string; questions: RawQuestion[] }[];
};

type QuizOption = { letter: string; text: string };

type QuizQuestion = {
	key: string;
	id: number;
	category: string;
	question: string;
	options: QuizOption[];
	answer: string;
	explanation?: string;
	sourceId: string;
};

type Source = {
	id: string;
	publisher: string;
	title: string;
	detail?: string;
};

type SetState =
	| { status: "loading" }
	| { status: "ready"; data: ProblemSet; questionTotal: number }
	| { status: "error"; message: string };

type View =
	| { name: "select" }
	| { name: "quiz"; file: string; questions: QuizQuestion[] }
	| {
			name: "results";
			file: string;
			questions: QuizQuestion[];
			responses: (string | null)[];
	  };

function cx(...classes: (string | false | null | undefined)[]) {
	return classes.filter(Boolean).join(" ");
}

function shuffle<T>(items: readonly T[]): T[] {
	const a = [...items];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j] as T, a[i] as T];
	}
	return a;
}

function isProblemSet(x: unknown): x is ProblemSet {
	if (!x || typeof x !== "object") return false;
	const o = x as Record<string, unknown>;
	return (
		typeof o.title === "string" &&
		Array.isArray(o.categories) &&
		(o.sources === undefined || Array.isArray(o.sources))
	);
}

function parseSource(raw: string): Source {
	const m = raw.match(/^\s*(\w{1,8})\s*:\s*([\s\S]+)$/);
	const id = m?.[1] ?? raw;
	let rest = (m?.[2] ?? raw).trim();

	let detail: string | undefined;
	const d = rest.match(/\s*\(([^()]*)\)\s*$/);
	if (d && d.index !== undefined) {
		detail = d[1];
		rest = rest.slice(0, d.index).trim();
	}

	const dash = rest.indexOf(" — ");
	return dash >= 0
		? { id, publisher: rest.slice(0, dash), title: rest.slice(dash + 3), detail }
		: { id, publisher: "", title: rest, detail };
}

function splitTitle(title: string) {
	const dash = title.indexOf(" — ");
	return dash >= 0
		? { eyebrow: title.slice(0, dash), main: title.slice(dash + 3) }
		: { eyebrow: "", main: title };
}

function toQuizQuestion(
	q: RawQuestion & { category: string },
	index: number,
): QuizQuestion {
	const entries = Object.entries(q.options);
	let order = shuffle(entries);
	for (
		let tries = 0;
		tries < 5 &&
		entries.length > 1 &&
		order.every(([k], j) => k === entries[j]?.[0]);
		tries++
	) {
		order = shuffle(entries);
	}

	const relabeled = order.map(([originalLetter, text], i) => ({
		originalLetter,
		letter: String.fromCharCode(65 + i),
		text,
	}));

	return {
		key: `${q.id}-${index}`,
		id: q.id,
		category: q.category,
		question: q.question,
		options: relabeled.map(({ letter, text }) => ({ letter, text })),
		answer: relabeled.find((o) => o.originalLetter === q.answer)?.letter ?? "",
		explanation: q.explanation,
		sourceId: q.source,
	};
}

function buildRound(set: ProblemSet): QuizQuestion[] {
	const pool = set.categories.flatMap((c) =>
		(c.questions ?? []).map((q) => ({ ...q, category: c.category })),
	);
	return shuffle(pool).slice(0, QUESTIONS_PER_ROUND).map(toQuizQuestion);
}

async function loadSet(file: string): Promise<SetState> {
	try {
		const res = await fetch(`${import.meta.env.BASE_URL}${file}`);
		if (!res.ok) throw new Error(`Couldn't load ${file} (HTTP ${res.status}).`);
		let data: unknown;
		try {
			data = await res.json();
		} catch {
			throw new Error(`${file} was not found or isn't valid JSON.`);
		}
		if (!isProblemSet(data)) {
			throw new Error(`${file} isn't in the expected problem-set format.`);
		}
		const questionTotal = data.categories.reduce(
			(n, c) => n + (c.questions?.length ?? 0),
			0,
		);
		if (questionTotal === 0) throw new Error(`${file} contains no questions.`);
		return {
			status: "ready",
			data: { ...data, sources: data.sources ?? [] },
			questionTotal,
		};
	} catch (e) {
		return {
			status: "error",
			message: e instanceof Error ? e.message : String(e),
		};
	}
}

function HomeComponent() {
	const [sets, setSets] = useState<Record<string, SetState>>(() =>
		Object.fromEntries(
			PROBLEM_SET_FILES.map((f) => [f, { status: "loading" } as SetState]),
		),
	);
	const [view, setView] = useState<View>({ name: "select" });
	const [round, setRound] = useState(0);

	useEffect(() => {
		let cancelled = false;
		for (const file of PROBLEM_SET_FILES) {
			loadSet(file).then((state) => {
				if (!cancelled) setSets((prev) => ({ ...prev, [file]: state }));
			});
		}
		return () => {
			cancelled = true;
		};
	}, []);

	const start = (file: string) => {
		const s = sets[file];
		if (s?.status !== "ready") return;
		setRound((r) => r + 1);
		setView({ name: "quiz", file, questions: buildRound(s.data) });
		window.scrollTo({ top: 0 });
	};

	const goHome = () => {
		setView({ name: "select" });
		window.scrollTo({ top: 0 });
	};

	const activeSet =
		view.name !== "select" && sets[view.file]?.status === "ready"
			? (sets[view.file] as Extract<SetState, { status: "ready" }>).data
			: null;

	return (
		<div className="container mx-auto max-w-3xl px-4 py-6">
			{view.name === "select" && <SelectView sets={sets} onStart={start} />}

			{view.name === "quiz" && activeSet && (
				<QuizView
					key={round}
					title={splitTitle(activeSet.title).main}
					questions={view.questions}
					onQuit={goHome}
					onFinish={(responses) => {
						setView({
							name: "results",
							file: view.file,
							questions: view.questions,
							responses,
						});
						window.scrollTo({ top: 0 });
					}}
				/>
			)}

			{view.name === "results" && activeSet && (
				<ResultsView
					set={activeSet}
					questions={view.questions}
					responses={view.responses}
					onRetry={() => start(view.file)}
					onHome={goHome}
				/>
			)}
		</div>
	);
}

function SelectView({
	sets,
	onStart,
}: {
	sets: Record<string, SetState>;
	onStart: (file: string) => void;
}) {
	const [openSources, setOpenSources] = useState<string | null>(null);

	return (
		<div className="space-y-6">
			<p className="text-muted-foreground">
				Choose a problem set. You'll get {QUESTIONS_PER_ROUND} random questions
				with {SECONDS_PER_QUESTION} seconds each. Wrong or blank answers cost
				nothing, and your score is revealed at the end.
			</p>

			<div className="space-y-4">
				{PROBLEM_SET_FILES.map((file) => {
					const s = sets[file] ?? { status: "loading" };

					if (s.status === "loading") {
						return (
							<div
								key={file}
								className="h-32 animate-pulse rounded-xl border bg-muted/40"
							/>
						);
					}

					if (s.status === "error") {
						return (
							<div
								key={file}
								className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground"
							>
								<p className="font-medium text-foreground">{file}</p>
								<p className="mt-1">{s.message}</p>
							</div>
						);
					}

					const { eyebrow, main } = splitTitle(s.data.title);
					const sourcesOpen = openSources === file;
					const count = Math.min(QUESTIONS_PER_ROUND, s.questionTotal);

					return (
						<section
							key={file}
							className="rounded-xl border bg-card p-5 text-card-foreground shadow-sm"
						>
							{eyebrow && (
								<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
									{eyebrow}
								</p>
							)}
							<h2 className="mt-1 text-lg font-semibold leading-snug">{main}</h2>
							<p className="mt-1 text-sm text-muted-foreground">
								{s.questionTotal} questions · {s.data.categories.length}{" "}
								categories · {s.data.sources.length} sources
							</p>

							<div className="mt-4 flex flex-wrap gap-2">
								<button
									type="button"
									onClick={() => onStart(file)}
									className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
								>
									Start {count} questions
								</button>
								<button
									type="button"
									aria-expanded={sourcesOpen}
									onClick={() => setOpenSources(sourcesOpen ? null : file)}
									className="rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-muted"
								>
									{sourcesOpen ? "Hide sources" : "View sources"}
								</button>
							</div>

							{sourcesOpen && (
								<div className="mt-4 border-t pt-4">
									<SourceList sources={s.data.sources} />
								</div>
							)}
						</section>
					);
				})}
			</div>
		</div>
	);
}

function SourceList({ sources }: { sources: string[] }) {
	if (sources.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">No sources listed.</p>
		);
	}
	return (
		<ol className="space-y-3">
			{sources.map(parseSource).map((s) => (
				<li key={s.id} className="flex gap-3 text-sm">
					<span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
						{s.id}
					</span>
					<div>
						<p className="font-medium leading-snug">{s.title}</p>
						<p className="text-muted-foreground">
							{[s.publisher, s.detail].filter(Boolean).join(" · ")}
						</p>
					</div>
				</li>
			))}
		</ol>
	);
}

function QuizView({
	title,
	questions,
	onFinish,
	onQuit,
}: {
	title: string;
	questions: QuizQuestion[];
	onFinish: (responses: (string | null)[]) => void;
	onQuit: () => void;
}) {
	const [index, setIndex] = useState(0);
	const responses = useRef<(string | null)[]>(questions.map(() => null));
	const question = questions[index];

	const handleSubmit = (answer: string | null) => {
		responses.current[index] = answer;
		if (index + 1 >= questions.length) {
			onFinish([...responses.current]);
		} else {
			setIndex(index + 1);
		}
	};

	if (!question) return null;

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between gap-4 text-sm">
				<p className="truncate text-muted-foreground">{title}</p>
				<button
					type="button"
					onClick={() => {
						if (window.confirm("Leave this round? It won't be scored.")) onQuit();
					}}
					className="shrink-0 text-muted-foreground underline-offset-4 hover:underline"
				>
					Quit
				</button>
			</div>

			<QuestionCard
				key={question.key}
				question={question}
				number={index + 1}
				total={questions.length}
				onSubmit={handleSubmit}
			/>
		</div>
	);
}

function QuestionCard({
	question,
	number,
	total,
	onSubmit,
}: {
	question: QuizQuestion;
	number: number;
	total: number;
	onSubmit: (answer: string | null) => void;
}) {
	const [selected, setSelected] = useState<string | null>(null);
	const [remainingMs, setRemainingMs] = useState(TOTAL_MS);
	const selectedRef = useRef<string | null>(null);
	const submittedRef = useRef(false);
	const onSubmitRef = useRef(onSubmit);

	useEffect(() => {
		onSubmitRef.current = onSubmit;
	});

	const submit = useCallback(() => {
		if (submittedRef.current) return;
		submittedRef.current = true;
		onSubmitRef.current(selectedRef.current);
	}, []);

	const choose = useCallback((letter: string) => {
		if (submittedRef.current) return;
		selectedRef.current = letter;
		setSelected(letter);
	}, []);

	useEffect(() => {
		const deadline = Date.now() + TOTAL_MS;
		const id = window.setInterval(() => {
			const left = Math.max(0, deadline - Date.now());
			setRemainingMs(left);
			if (left === 0) {
				window.clearInterval(id);
				submit();
			}
		}, TICK_MS);
		return () => window.clearInterval(id);
	}, [submit]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			const byLetter = question.options.find(
				(o) => o.letter === e.key.toUpperCase(),
			);
			const n = Number.parseInt(e.key, 10);
			const byNumber = Number.isNaN(n) ? undefined : question.options[n - 1];
			const opt = byLetter ?? byNumber;
			if (opt) {
				e.preventDefault();
				choose(opt.letter);
			} else if (e.key === "Enter") {
				e.preventDefault();
				submit();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [question.options, choose, submit]);

	const seconds = Math.ceil(remainingMs / 1000);
	const low = seconds <= LOW_TIME_SECONDS;
	const pct = (remainingMs / TOTAL_MS) * 100;
	const isLast = number === total;

	return (
		<div className="space-y-6 rounded-xl border bg-card p-5 text-card-foreground shadow-sm sm:p-6">
			<div className="space-y-2">
				<div className="flex items-center justify-between text-sm">
					<span className="text-muted-foreground">
						Question {number} of {total}
					</span>
					<span
						className={cx(
							"font-semibold tabular-nums",
							low && "text-red-600 dark:text-red-400",
						)}
						aria-live="polite"
					>
						{seconds}s
					</span>
				</div>
				<div
					className="h-2 overflow-hidden rounded-full bg-muted"
					role="progressbar"
					aria-label="Time remaining"
					aria-valuemin={0}
					aria-valuemax={SECONDS_PER_QUESTION}
					aria-valuenow={seconds}
				>
					<div
						className={cx(
							"h-full transition-[width] duration-100 ease-linear",
							low ? "bg-red-500" : "bg-primary",
						)}
						style={{ width: `${pct}%` }}
					/>
				</div>
			</div>

			<div>
				<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
					{question.category}
				</p>
				<h2 className="mt-2 text-xl font-semibold leading-snug">
					{question.question}
				</h2>
			</div>

			<div role="radiogroup" aria-label="Answer choices" className="grid gap-2">
				{question.options.map((o) => {
					const active = selected === o.letter;
					return (
						<button
							key={o.letter}
							type="button"
							role="radio"
							aria-checked={active}
							onClick={() => choose(o.letter)}
							className={cx(
								"flex items-start gap-3 rounded-lg border p-3 text-left transition",
								active
									? "border-primary bg-primary/10 ring-1 ring-primary"
									: "hover:bg-muted",
							)}
						>
							<span
								className={cx(
									"flex size-7 shrink-0 items-center justify-center rounded-md border text-sm font-semibold",
									active && "border-primary bg-primary text-primary-foreground",
								)}
							>
								{o.letter}
							</span>
							<span className="pt-0.5">{o.text}</span>
						</button>
					);
				})}
			</div>

			<div className="flex items-center justify-between gap-4">
				<p className="hidden text-xs text-muted-foreground sm:block">
					Press A–D to choose, Enter to continue
				</p>
				<button
					type="button"
					onClick={submit}
					className="ml-auto rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
				>
					{isLast ? "Finish" : selected ? "Next" : "Skip"}
				</button>
			</div>
		</div>
	);
}

function ResultsView({
	set,
	questions,
	responses,
	onRetry,
	onHome,
}: {
	set: ProblemSet;
	questions: QuizQuestion[];
	responses: (string | null)[];
	onRetry: () => void;
	onHome: () => void;
}) {
	const sources = useMemo(
		() => new Map(set.sources.map(parseSource).map((s) => [s.id, s])),
		[set],
	);

	const correct = questions.filter((q, i) => responses[i] === q.answer).length;
	const blank = responses.filter((r) => r === null).length;
	const wrong = questions.length - correct - blank;

	return (
		<div className="space-y-6">
			<section className="rounded-xl border bg-card p-6 text-center text-card-foreground shadow-sm">
				<p className="text-sm text-muted-foreground">Your score</p>
				<p className="mt-1 text-5xl font-bold tabular-nums">
					{correct}
					<span className="text-2xl text-muted-foreground"> / {questions.length}</span>
				</p>
				<p className="mt-3 text-sm text-muted-foreground">
					{correct} correct · {wrong} incorrect · {blank} unanswered
				</p>
				<div className="mt-5 flex flex-wrap justify-center gap-2">
					<button
						type="button"
						onClick={onRetry}
						className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
					>
						New round, same set
					</button>
					<button
						type="button"
						onClick={onHome}
						className="rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-muted"
					>
						Choose another set
					</button>
				</div>
			</section>

			<h2 className="text-lg font-semibold">Review</h2>

			<ol className="space-y-4">
				{questions.map((q, i) => {
					const picked = responses[i] ?? null;
					const status =
						picked === null ? "blank" : picked === q.answer ? "correct" : "wrong";
					const src = sources.get(q.sourceId);

					return (
						<li
							key={q.key}
							className="rounded-xl border bg-card p-5 text-card-foreground shadow-sm"
						>
							<div className="flex items-start justify-between gap-3">
								<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
									Q{i + 1} · {q.category}
								</p>
								<span
									className={cx(
										"shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
										status === "correct" &&
											"bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
										status === "wrong" &&
											"bg-red-500/15 text-red-700 dark:text-red-400",
										status === "blank" && "bg-muted text-muted-foreground",
									)}
								>
									{status === "correct"
										? "Correct"
										: status === "wrong"
											? "Incorrect"
											: "Unanswered"}
								</span>
							</div>

							<h3 className="mt-2 font-semibold leading-snug">{q.question}</h3>

							<ul className="mt-3 grid gap-2">
								{q.options.map((o) => {
									const isAnswer = o.letter === q.answer;
									const isPicked = o.letter === picked;
									return (
										<li
											key={o.letter}
											className={cx(
												"flex items-start gap-3 rounded-lg border p-2.5 text-sm",
												isAnswer && "border-emerald-500/60 bg-emerald-500/10",
												isPicked && !isAnswer && "border-red-500/60 bg-red-500/10",
												!isAnswer && !isPicked && "opacity-75",
											)}
										>
											<span className="flex size-6 shrink-0 items-center justify-center rounded border text-xs font-semibold">
												{o.letter}
											</span>
											<span className="flex-1 pt-0.5">{o.text}</span>
											{isAnswer && (
												<span className="shrink-0 pt-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
													Correct answer
												</span>
											)}
											{isPicked && !isAnswer && (
												<span className="shrink-0 pt-0.5 text-xs font-medium text-red-700 dark:text-red-400">
													Your answer
												</span>
											)}
										</li>
									);
								})}
							</ul>

							{status === "blank" && (
								<p className="mt-2 text-xs text-muted-foreground">
									No answer given before time ran out.
								</p>
							)}

							{q.explanation && <p className="mt-3 text-sm">{q.explanation}</p>}

							<p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
								<span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
									{q.sourceId}
								</span>
								{src ? (
									<>
										{src.publisher && <>{src.publisher} — </>}
										<span className="text-foreground">{src.title}</span>
										{src.detail && <> ({src.detail})</>}
									</>
								) : (
									"Source not listed"
								)}
							</p>
						</li>
					);
				})}
			</ol>
		</div>
	);
}
