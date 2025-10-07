import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { getTestUserId, getFirebaseAdminFirestore } from "@spark/llm";
import {
  SessionSchema,
  SessionStateSchema,
  QuizDefinitionSchema,
  CodeProblemSchema,
} from "@spark/schemas";
import type {
  PlanItem,
  Session,
  SessionState,
  QuizDefinition,
  CodeProblem,
} from "@spark/schemas";

function generateSessionId(): string {
  return "dp-coin-change-decode";
}

function generateSessionTitle(): string {
  return "Warm-up quiz";
}

const QUIZZES: QuizDefinition[] = [
  {
    id: "dp-warmup-quiz",
    title: "DP Warm-up: Basics",
    topic: "Dynamic Programming",
    estimatedMinutes: 3,
    progressKey: "warmup",
    description:
      "Three very short questions to build intuition—no formulas needed.",
    questions: [
      {
        kind: "multiple-choice",
        id: "dp-warmup-overlap",
        prompt: "What is the big idea behind dynamic programming (DP)?",
        hint: "Think “break, solve small, remember, reuse”.",
        explanation:
          "DP means breaking a problem into smaller pieces, solving those small pieces once, saving the answers, and reusing them so you do not repeat work.",
        options: [
          {
            id: "A",
            label: "A",
            text: "Try everything randomly and hope for the best",
          },
          {
            id: "B",
            label: "B",
            text: "Break problems into smaller parts and reuse saved answers",
          },
          { id: "C", label: "C", text: "Sort the input to make it faster" },
          { id: "D", label: "D", text: "Draw a graph and do BFS every time" },
        ],
        correctOptionId: "B",
        correctFeedback: {
          heading: "Nice work",
          message: "Breaking a problem down and reusing solved pieces is the heart of DP.",
        },
      },
      {
        kind: "multiple-choice",
        id: "dp-warmup-base-case",
        prompt: "What is a “base case” in DP?",
        hint: "Start from something you already know.",
        explanation:
          "A base case is a tiny version of the problem with an answer you already know. It anchors everything else you build.",
        options: [
          {
            id: "A",
            label: "A",
            text: "A fancy optimization that makes code faster",
          },
          {
            id: "B",
            label: "B",
            text: "A simple starting situation with a known answer",
          },
          { id: "C", label: "C", text: "The biggest input you plan to test" },
          {
            id: "D",
            label: "D",
            text: "A sign that the problem has no solution",
          },
        ],
        correctOptionId: "B",
        correctFeedback: {
          heading: "Nice work",
          message: "Anchoring the table with a tiny, known answer is exactly how base cases work.",
        },
      },
      {
        kind: "multiple-choice",
        id: "dp-warmup-order",
        prompt: "Why do DP solutions keep a table/array/map of results?",
        hint: "Think about not solving the same thing twice.",
        explanation:
          "The table stores answers you have already computed so later steps can reuse them instead of recomputing.",
        options: [
          { id: "A", label: "A", text: "To print the results in a nice grid" },
          {
            id: "B",
            label: "B",
            text: "To store answers we have already computed so we can reuse them",
          },
          {
            id: "C",
            label: "C",
            text: "To make the code longer and more complex",
          },
          {
            id: "D",
            label: "D",
            text: "To use more memory because memory is cheap",
          },
        ],
        correctOptionId: "B",
        correctFeedback: {
          heading: "Nice work",
          message: "Keeping a table of solved states is exactly how DP avoids recomputing work.",
        },
      },
    ],
  },
  {
    id: "dp-topic-deck",
    title: "DP Basics: Break · Store · Reuse",
    topic: "Dynamic Programming",
    estimatedMinutes: 5,
    progressKey: "topic",
    description:
      "Two simple idea cards, then three easy checks to confirm understanding.",
    questions: [
      {
        kind: "info-card",
        id: "dp-topic-card-1",
        prompt: "What DP tries to do",
        eyebrow: "Concept",
        body: "Solve a problem by building from small, easy cases. Save answers as you go so you can reuse them later instead of redoing work.",
        continueLabel: "Next idea",
      },
      {
        kind: "info-card",
        id: "dp-topic-card-2",
        prompt: "Two friendly styles",
        eyebrow: "Modes",
        body: "Memoization (top‑down): write a recursive function and remember results. Tabulation (bottom‑up): fill a small table from simple to harder cases. Both do the same thing: reuse answers.",
        continueLabel: "Let's practice",
      },
      {
        kind: "multiple-choice",
        id: "dp-topic-question-1",
        prompt: "Which sentence best describes memoization?",
        hint: "Think “remember answers to function calls”.",
        explanation:
          "Memoization means caching the result for a given input so future calls with that input can return immediately.",
        options: [
          { id: "A", label: "A", text: "Run your code twice to be extra sure" },
          {
            id: "B",
            label: "B",
            text: "Remember results of function calls so you can reuse them",
          },
          {
            id: "C",
            label: "C",
            text: "Sort the input before any computation",
          },
          { id: "D", label: "D", text: "Avoid loops and only use recursion" },
        ],
        correctOptionId: "B",
        correctFeedback: {
          heading: "Nice work",
          message: "Caching function results so later calls return instantly is exactly memoization.",
        },
      },
      {
        kind: "multiple-choice",
        id: "dp-topic-question-2",
        prompt: "What is a good first step when starting a DP problem?",
        hint: "Describe the state and start tiny.",
        explanation:
          "Define the “state” in plain words (what a subproblem means) and set a tiny base case. That gives you a solid, simple starting point.",
        options: [
          {
            id: "A",
            label: "A",
            text: "Write the final formula before doing examples",
          },
          {
            id: "B",
            label: "B",
            text: "Define the state in words and set a small base case",
          },
          { id: "C", label: "C", text: "Code 100 lines and refactor later" },
          { id: "D", label: "D", text: "Guess an answer and move on" },
        ],
        correctOptionId: "B",
        correctFeedback: {
          heading: "Nice work",
          message: "Starting with a clear state and tiny base case sets up every DP solution.",
        },
      },
      {
        kind: "multiple-choice",
        id: "dp-topic-question-3",
        prompt:
          "If you notice the same small question being asked many times, what should you do?",
        hint: "Reuse beats redo.",
        explanation:
          "Save that small answer (cache/table) and reuse it whenever you need it again. That is the whole point of DP.",
        options: [
          {
            id: "A",
            label: "A",
            text: "Ignore duplicates and recompute to be safe",
          },
          {
            id: "B",
            label: "B",
            text: "Store the answer once and reuse it later",
          },
          {
            id: "C",
            label: "C",
            text: "Increase recursion depth to explore more",
          },
          {
            id: "D",
            label: "D",
            text: "Switch to a completely different algorithm immediately",
          },
        ],
        correctOptionId: "B",
        correctFeedback: {
          heading: "Nice work",
          message: "Spotting repeated subproblems and caching them is the core DP habit.",
        },
      },
    ],
  },
  {
    id: "dp-review-quiz",
    title: "DP Review: Ready to Start",
    topic: "Dynamic Programming",
    estimatedMinutes: 4,
    progressKey: "review",
    description: "Three friendly checkups using everyday DP thinking.",
    questions: [
      {
        kind: "multiple-choice",
        id: "dp-review-stairs",
        prompt:
          "You can climb stairs by taking 1 or 2 steps at a time. How can you think about the ways to reach a step n?",
        hint: "Consider how you could arrive at step n.",
        explanation:
          "To stand on step n you either came from n−1 with a 1‑step or from n−2 with a 2‑step, so you add those counts together.",
        options: [
          {
            id: "A",
            label: "A",
            text: "Double the number of ways to reach step n−1",
          },
          {
            id: "B",
            label: "B",
            text: "Add the ways to reach steps n−1 and n−2",
          },
          {
            id: "C",
            label: "C",
            text: "Subtract the ways to reach step n−2 from n−1",
          },
          {
            id: "D",
            label: "D",
            text: "Multiply the ways to reach steps n−1 and n−2",
          },
        ],
        correctOptionId: "B",
        correctFeedback: {
          heading: "Nice work",
          message: "Combining the n−1 and n−2 paths is exactly how the stair DP recurrence works.",
        },
      },
      {
        kind: "multiple-choice",
        id: "dp-review-grid",
        prompt:
          "In a grid where you can move only right or down, what is true about the top row and the left column?",
        hint: "Think about how many choices you have along an edge.",
        explanation:
          "Along the top row and left column there is only one way forward, so each of those cells has exactly one path to it.",
        options: [
          {
            id: "A",
            label: "A",
            text: "There are zero ways to move along them.",
          },
          {
            id: "B",
            label: "B",
            text: "Each cell on those edges has exactly one way to reach it.",
          },
          {
            id: "C",
            label: "C",
            text: "You must always start from the bottom-right corner.",
          },
          {
            id: "D",
            label: "D",
            text: "They require a special formula for every cell.",
          },
        ],
        correctOptionId: "B",
        correctFeedback: {
          heading: "Nice work",
          message: "Recognising the single-path edges sets up the grid DP base cases perfectly.",
        },
      },
      {
        kind: "multiple-choice",
        id: "dp-review-memo",
        prompt:
          "When should you save an answer in a memoized (remembering) solution?",
        hint: "Save it once; reuse many times.",
        explanation:
          "Right after you compute a subproblem’s answer, store it so the next time you see the same input you can return it immediately.",
        options: [
          {
            id: "A",
            label: "A",
            text: "Before recursing, even if you have no answer yet",
          },
          {
            id: "B",
            label: "B",
            text: "After computing a subproblem so repeated calls can reuse it",
          },
          {
            id: "C",
            label: "C",
            text: "Only if the answer happens to be zero",
          },
          {
            id: "D",
            label: "D",
            text: "Never—just recompute every time for clarity",
          },
        ],
        correctOptionId: "B",
        correctFeedback: {
          heading: "Nice work",
          message: "Storing the answer right after you compute it is what makes memoization shine.",
        },
      },
    ],
  },
];

const coinChangeExampleOne = {
  title: "Example 1",
  input: ["5", "3", "1 2 5"].join("\n"),
  output: "4",
  explanation:
    "Four combinations: 5; 2 + 2 + 1; 2 + 1 + 1 + 1; 1 + 1 + 1 + 1 + 1.",
};

const coinChangeExampleTwo = {
  title: "Example 2",
  input: ["3", "1", "2"].join("\n"),
  output: "0",
  explanation:
    "Coin value 2 never sums to 3, so there are no valid combinations.",
};

const coinChangeExampleThree = {
  title: "Example 3",
  input: ["10", "4", "1 3 4 5"].join("\n"),
  output: "12",
  explanation:
    "Using {1, 3, 4, 5} there are 12 combinations, including 5 + 5, 4 + 4 + 1 + 1, 4 + 3 + 3, and 3 + 3 + 3 + 1.",
};

const COIN_CHANGE_EXAMPLES = [
  coinChangeExampleOne,
  coinChangeExampleTwo,
  coinChangeExampleThree,
];

const COIN_CHANGE_TESTS = [
  {
    input: coinChangeExampleOne.input,
    output: coinChangeExampleOne.output,
    explanation: coinChangeExampleOne.explanation,
  },
  {
    input: coinChangeExampleTwo.input,
    output: coinChangeExampleTwo.output,
    explanation: coinChangeExampleTwo.explanation,
  },
  {
    input: coinChangeExampleThree.input,
    output: coinChangeExampleThree.output,
    explanation: coinChangeExampleThree.explanation,
  },
  {
    input: ["0", "3", "2 3 5"].join("\n"),
    output: "1",
  },
  {
    input: ["7", "4", "2 3 4 7"].join("\n"),
    output: "3",
  },
  {
    input: ["9", "3", "2 3 4"].join("\n"),
    output: "3",
  },
  {
    input: ["12", "3", "3 4 6"].join("\n"),
    output: "4",
  },
  {
    input: ["12", "2", "5 7"].join("\n"),
    output: "1",
  },
  {
    input: ["30", "3", "2 5 10"].join("\n"),
    output: "10",
  },
  {
    input: ["18", "3", "1 5 9"].join("\n"),
    output: "7",
  },
  {
    input: ["100", "4", "1 5 10 25"].join("\n"),
    output: "242",
  },
  {
    input: ["25", "3", "3 7 11"].join("\n"),
    output: "3",
  },
  {
    input: ["50", "6", "1 2 5 10 20 50"].join("\n"),
    output: "451",
  },
  {
    input: ["63", "4", "3 5 9 21"].join("\n"),
    output: "38",
  },
  {
    input: ["200", "8", "1 2 5 10 20 50 100 200"].join("\n"),
    output: "73682",
  },
];

const decodeExampleOne = {
  title: "Example 1",
  input: "12",
  output: "2",
  explanation: 'Two decodings: "AB" (1|2) and "L" (12).',
};

const decodeExampleTwo = {
  title: "Example 2",
  input: "226",
  output: "3",
  explanation:
    'Three decodings: "BZ" (2|26), "VF" (22|6), and "BBF" (2|2|6).',
};

const decodeExampleThree = {
  title: "Example 3",
  input: "101",
  output: "1",
  explanation: 'Only "JA" (10|1) is valid because "01" is not a letter.',
};

const DECODE_EXAMPLES = [
  decodeExampleOne,
  decodeExampleTwo,
  decodeExampleThree,
];

const DECODE_TESTS = [
  {
    input: decodeExampleOne.input,
    output: decodeExampleOne.output,
    explanation: decodeExampleOne.explanation,
  },
  {
    input: decodeExampleTwo.input,
    output: decodeExampleTwo.output,
    explanation: decodeExampleTwo.explanation,
  },
  {
    input: decodeExampleThree.input,
    output: decodeExampleThree.output,
    explanation: decodeExampleThree.explanation,
  },
  {
    input: "06",
    output: "0",
  },
  {
    input: "0",
    output: "0",
  },
  {
    input: "27",
    output: "1",
  },
  {
    input: "2101",
    output: "1",
  },
  {
    input: "111111",
    output: "13",
  },
  {
    input: "2611055971756562",
    output: "4",
  },
  {
    input: "123123123",
    output: "27",
  },
  {
    input: "100",
    output: "0",
  },
  {
    input: "301",
    output: "0",
  },
  {
    input: "1",
    output: "1",
  },
  {
    input: "3015",
    output: "0",
  },
];

const PROBLEMS: CodeProblem[] = [
  {
    slug: "coin-change-ways",
    title: "Coin Change Ways",
    difficulty: "easy",
    topics: ["Dynamic Programming", "Combinatorics"],
    description: [
      "You are stocking a kiosk with unlimited copies of several coin denominations. Given a target amount, count how many unique combinations of these coins sum to the target. Order does not matter—3 + 2 + 2 is the same as 2 + 3 + 2.",
      "",
      "Write a program that reads the amount, the number of distinct coin values, and the coin values themselves from standard input. Print only the number of combinations."
    ].join("\n"),
    inputFormat: [
      "- Line 1: integer A — the target amount.",
      "- Line 2: integer K — the number of distinct coin values provided.",
      "- Line 3: K space-separated integers listing each coin value. Duplicate numbers should be treated as the same coin."
    ].join("\n"),
    constraints: [
      "0 ≤ A ≤ 5000",
      "1 ≤ K ≤ 60",
      "1 ≤ coin value ≤ 5000",
      "The answer fits in a 64-bit signed integer"
    ],
    examples: COIN_CHANGE_EXAMPLES,
    tests: COIN_CHANGE_TESTS,
    hints: [
      "Sort and deduplicate the coin values, then think about building amounts from 0 up to A.",
      "Let dp[x] be the number of ways to make amount x. Iterate coins on the outside so different orders of the same coins are not counted twice.",
      "Set dp[0] = 1 and for each coin add dp[x - coin] into dp[x] for every x ≥ coin. The final dp[A] is the answer."
    ],
    solution: {
      language: "python",
      code: [
        "import sys",
        "",
        "data = sys.stdin.read().strip().split()",
        "if not data:",
        "    sys.exit(0)",
        "it = iter(data)",
        "amount = int(next(it))",
        "coin_count = int(next(it))",
        "coins = [int(next(it)) for _ in range(coin_count)]",
        "coins = sorted(set(coins))",
        "",
        "dp = [0] * (amount + 1)",
        "dp[0] = 1",
        "for coin in coins:",
        "    for value in range(coin, amount + 1):",
        "        dp[value] += dp[value - coin]",
        "",
        "print(dp[amount])",
      ].join("\n"),
    },
    metadataVersion: 2,
  },
  {
    slug: "decode-ways",
    title: "Decode Ways",
    difficulty: "easy",
    topics: ["Dynamic Programming", "Strings"],
    description: [
      "Digits 1 through 26 map to uppercase letters A through Z. Given a digit string with no separators, count how many different letter sequences it can represent. For example, \"226\" can decode to \"BBF\", \"BZ\", or \"VF\".",
      "",
      "Write a program that reads the digit string from standard input and prints the number of distinct decodings. The program must read from stdin and write only the integer count."
    ].join("\n"),
    inputFormat: [
      "- A single line containing the digit string s."
    ].join("\n"),
    constraints: [
      "1 ≤ |s| ≤ 100",
      "s consists only of characters '0'–'9'",
      "The answer fits in a 32-bit signed integer"
    ],
    examples: DECODE_EXAMPLES,
    tests: DECODE_TESTS,
    hints: [
      "Process the string left to right and consider how many ways each prefix can be decoded.",
      "At position i, you can extend with s[i] when it is 1–9 and with s[i-1:i+1] when it forms a number 10–26.",
      "Maintain two rolling counts: ways up to i-2 and ways up to i-1. Combine them to produce the current count."
    ],
    solution: {
      language: "python",
      code: [
        "import sys",
        "",
        "",
        "def count_decodings(s: str) -> int:",
        "    if not s or s[0] == \"0\":",
        "        return 0",
        "",
        "    prev2 = 1",
        "    prev1 = 1",
        "    for index in range(1, len(s)):",
        "        current = 0",
        "        if s[index] != \"0\":",
        "            current += prev1",
        "        pair = int(s[index - 1 : index + 1])",
        "        if 10 <= pair <= 26:",
        "            current += prev2",
        "        if current == 0:",
        "            return 0",
        "        prev2, prev1 = prev1, current",
        "",
        "    return prev1",
        "data = sys.stdin.read().strip()",
        "if not data:",
        "    sys.exit(0)",
        "s = data.split()[0]",
        "print(count_decodings(s))",
      ].join("\n"),
    },
    metadataVersion: 2,
  },
];

function buildPlan(): PlanItem[] {
  return [
    {
      id: "dp-warmup-quiz",
      kind: "quiz",
      title: "Warm-up quiz",
      icon: "🔥",
      meta: "3 quick checks",
      summary:
        "Prime your DP mindset with three quick conceptual prompts before diving in.",
    },
    {
      id: "dp-topic-deck",
      kind: "quiz",
      title: "Topic deck",
      icon: "🧠",
      meta: "5 guided steps",
      summary:
        "Explore memoization vs. tabulation with a friendly mixture of info cards and micro-quizzes.",
    },
    {
      id: "coin-change-ways",
      kind: "problem",
      title: "Practice · Coin Change Ways",
      icon: "🪙",
      meta: "DP • Easy",
      summary:
        "Count the combinations to reach a target amount when coins are unlimited.",
    },
    {
      id: "decode-ways",
      kind: "problem",
      title: "Challenge · Decode Ways",
      icon: "🔐",
      meta: "DP • Easy",
      summary:
        "Turn digit strings into letter counts with a memoized recursion pattern.",
    },
    {
      id: "dp-review-quiz",
      kind: "quiz",
      title: "Final review quiz",
      icon: "✅",
      meta: "3 questions",
      summary:
        "Confirm the DP transition sticks with a final three-question review.",
    },
  ];
}

async function seedContent(userId: string, session: Session) {
  const firestore = getFirebaseAdminFirestore();
  const userRef = firestore.collection("spark").doc(userId);
  const stateRef = userRef.collection("state").doc(session.id);
  const sessionRef = userRef.collection("sessions").doc(session.id);

  const initialState: SessionState = SessionStateSchema.parse({
    sessionId: session.id,
    items: session.plan.reduce<Record<string, SessionState["items"][string]>>(
      (acc, item) => {
        acc[item.id] = { status: "not_started" };
        return acc;
      },
      {} as Record<string, SessionState["items"][string]>,
    ),
    lastUpdatedAt: Timestamp.now(),
  });

  await stateRef.set(initialState);

  await Promise.all(
    QUIZZES.map(async (quiz) => {
      const parsed = QuizDefinitionSchema.parse(quiz);
      await sessionRef.collection("quiz").doc(parsed.id).set(parsed);
    }),
  );

  await Promise.all(
    PROBLEMS.map(async (problem) => {
      const parsed = CodeProblemSchema.parse(problem);
      await sessionRef.collection("code").doc(parsed.slug).set(parsed);
    }),
  );

  return userRef;
}

async function main(): Promise<void> {
  const userId = getTestUserId();
  const sessionId = generateSessionId();

  const sessionData = {
    id: sessionId,
    title: generateSessionTitle(),
    createdAt: Timestamp.now(),
    plan: buildPlan(),
  } satisfies z.input<typeof SessionSchema>;

  const session = SessionSchema.parse(sessionData);

  const userRef = await seedContent(userId, session);

  await userRef.collection("sessions").doc(session.id).set(sessionData);
  await userRef.set({ currentSessionId: session.id }, { merge: true });

  console.log(`Created session ${session.id} for test user ${userId}`);
}

main().catch((error) => {
  console.error("Failed to generate test session", error);
  process.exit(1);
});
