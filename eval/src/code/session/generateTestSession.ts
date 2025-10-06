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

const PROBLEMS: CodeProblem[] = [
  {
    slug: "coin-change-ways",
    title: "Coin Change Ways",
    summary:
      "Count the number of combinations that make a target amount using unlimited coins.",
    summaryBullets: [
      "Classic unbounded knapsack / coin change counting variant",
      "Order does not matter—combinations are sets of coin counts",
      "Use DP where state is amount and iterate coins outer-most",
    ],
    difficulty: "easy",
    primaryTopic: "Dynamic Programming",
    topics: ["Dynamic Programming", "Combinatorics"],
    tags: ["dp", "combinations", "coin-change"],
    tasks: [
      "Return the total number of ways to form the amount",
      "Unlimited copies of each coin are available",
    ],
    constraints: [
      "1 ≤ amount ≤ 5000",
      "1 ≤ coins.length ≤ 50",
      "1 ≤ coins[i] ≤ amount",
    ],
    edgeCases: [
      "Amount 0 should return 1 (empty combination)",
      "If no coins can form the amount, return 0",
      "Duplicate coin values should be deduplicated or handled carefully",
    ],
    hints: [
      "Sort coins so combinations are counted once",
      "dp[a] = number of ways to make amount a",
      "Iterate coins outer loop so each coin contributes once",
    ],
    followUpIdeas: [
      "What if each coin can only be used at most once?",
      "How would you output one actual combination?",
    ],
    examples: [
      {
        label: "Example 1",
        input: "amount = 5, coins = [1,2,5]",
        output: "4",
        explanation: "Combinations: 5, 2+2+1, 2+1+1+1, 1+1+1+1+1",
      },
      {
        label: "Example 2",
        input: "amount = 3, coins = [2]",
        output: "0",
        explanation: "You cannot form amount 3 using only 2s",
      },
    ],
    solution: {
      optimal: {
        title: "Bottom-up DP over amount",
        overview:
          "Use a one-dimensional DP array where dp[a] counts combinations for amount a. Iterate coins first to avoid permutations.",
        steps: [
          "Initialise dp array of size amount + 1 with dp[0] = 1",
          "For each coin, update dp[a] += dp[a - coin] for all a ≥ coin",
          "Return dp[amount]",
        ],
        timeComplexity: "O(amount * coins.length)",
        spaceComplexity: "O(amount)",
        keyIdeas: [
          "Iterate coins outer loop to avoid counting order variations",
          "dp[a] uses previous value of same array for current coin",
        ],
      },
      alternatives: [
        {
          title: "Top-down memoized recursion",
          overview:
            "Recurse on index and remaining amount, memoising results. Equivalent complexity but conceptually closer to recursive decomposition.",
          steps: [
            "Sort coins ascending",
            "Define dfs(i, remaining) returning ways using coins[i:]",
            "Memoise by (i, remaining) to avoid recomputation",
          ],
          timeComplexity: "O(amount * coins.length)",
          spaceComplexity: "O(amount + coins.length)",
          keyIdeas: [
            "Memoisation",
            "Avoid permutations by non-decreasing coin indexes",
          ],
        },
      ],
    },
    source: {
      path: "generated/dp/coin-change-ways.md",
      markdown:
        "# Coin Change Ways\n\nGiven an integer amount and an array of coin denominations, return the number of combinations that make up that amount. Order does not matter. Use dynamic programming to accumulate combinations, iterating coins on the outer loop so permutations collapse into single counts.",
    },
    metadataVersion: 1,
    starterCode:
      "" +
      "def change(amount: int, coins: list[int]) -> int:\n" +
      "    # TODO: implement\n" +
      "    return 0\n",
  },
  {
    slug: "decode-ways",
    title: "Decode Ways",
    summary:
      "Count how many ways a digit string can map to letters using A=1 .. Z=26.",
    summaryBullets: [
      "Classic DP over string index",
      "Handle zeros carefully—they must pair with 1 or 2",
      "Use one- or two-character transitions",
    ],
    difficulty: "easy",
    primaryTopic: "Dynamic Programming",
    topics: ["Dynamic Programming", "Strings"],
    tags: ["dp", "strings", "decode-ways"],
    tasks: ["Return count of valid decodings", "Digits map A=1 through Z=26"],
    constraints: ["1 ≤ s.length ≤ 100", "s contains digits only"],
    edgeCases: [
      "Leading zero invalid",
      "'10' and '20' valid but '30' invalid",
      "Long runs of zeros should return 0",
    ],
    hints: [
      "dp[i] = ways to decode prefix of length i",
      "Single digit valid if 1-9",
      "Pair valid if between 10 and 26 inclusive",
    ],
    followUpIdeas: [
      "Return sample decoding instead of count",
      "Handle '*' wildcard digits (LeetCode Hard variant)",
    ],
    examples: [
      {
        label: "Example 1",
        input: 's = "12"',
        output: "2",
        explanation: "1-2 → AB, 12 → L",
      },
      {
        label: "Example 2",
        input: 's = "226"',
        output: "3",
        explanation: "2-2-6, 22-6, 2-26",
      },
      {
        label: "Example 3",
        input: 's = "06"',
        output: "0",
        explanation: "Leading zero means invalid",
      },
    ],
    solution: {
      optimal: {
        title: "Bottom-up DP with constant space",
        overview:
          "Traverse the string and count decodings using previous two counts, checking valid single and double digit windows.",
        steps: [
          "Initialise prev2 = 1 (empty string), prev1 = 1 if first char valid else 0",
          "For each index, compute current based on valid single and double digit segments",
          "Slide window by updating prev2, prev1",
        ],
        timeComplexity: "O(n)",
        spaceComplexity: "O(1)",
        keyIdeas: [
          "Treat invalid zero cases carefully",
          "Reuse two rolling variables instead of full array",
        ],
      },
      alternatives: [
        {
          title: "Top-down recursion with memo",
          overview:
            "Recursively decode starting at each index and memoise. Same complexity but easier to reason about for some learners.",
          steps: [
            "If current char is 0 return 0",
            "Take single digit and double digit (if valid) recursions",
            "Memoise index to count",
          ],
          timeComplexity: "O(n)",
          spaceComplexity: "O(n)",
          keyIdeas: ["Memoisation", "Two-character branching"],
        },
      ],
    },
    source: {
      path: "generated/dp/decode-ways.md",
      markdown:
        "# Decode Ways\n\nGiven a digit string s, return the number of ways to decode it using the mapping A=1, …, Z=26. Use DP to consider one- and two-digit transitions while rejecting invalid zeros.",
    },
    metadataVersion: 1,
    starterCode:
      "def num_decodings(s: str) -> int:\n" +
      "    # TODO: implement\n" +
      "    return 0\n",
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
