import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import {
  getTestUserId,
  getFirebaseAdminFirestore,
  publishSessionMediaClip,
  parseFirebaseServiceAccount,
} from "@spark/llm";
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
import type { MediaSegment, SessionAudioResult } from "@spark/llm";

import {
  TEST_SESSION_ID,
  TEST_SESSION_TITLE,
  INTRO_PLAN_ITEM_ID,
  OUTRO_PLAN_ITEM_ID,
} from "./constants";
import { ensureEvalEnvLoaded, WORKSPACE_PATHS } from "../../utils/paths";

const INTRO_AUDIO_FILE = "test-session-intro.mp3";
const OUTRO_AUDIO_FILE = "test-session-outro.mp3";
const AUDIO_MIME_TYPE = "audio/mpeg";
const DEFAULT_SAMPLE_RATE = 24_000;
const DEFAULT_CHANNELS: 1 = 1;
const FALLBACK_LINE_DURATION_SEC = 4.5;
const MIN_LINE_DURATION_SEC = 1.4;

const INTRO_MEDIA_SEGMENTS: MediaSegment[] = [
  {
    slide: "# Dynamic Programming\nBreak · Store · Reuse",
    narration: [
      {
        speaker: "m",
        text:
          "Welcome. Today’s session builds practical intuition for dynamic programming: breaking problems into smaller pieces, storing answers, and reusing them to avoid repeated work.",
      },
      {
        speaker: "f",
        text:
          "Think of it like LEGO: once you’ve built a sturdy mini‑module, you don’t rebuild it—you snap it in again whenever you need that shape.",
      },
    ],
  },
  {
    slide: "### A short story\nRichard Bellman, 1950s",
    narration: [
      {
        speaker: "m",
        text:
          "The term ‘dynamic programming’ dates to the 1950s. Richard Bellman used ‘programming’ in the classical sense of planning, and ‘dynamic’ to emphasize decisions unfolding over stages.",
      },
      {
        speaker: "f",
        text:
          "The big idea stuck because it solves real problems—from routing and scheduling to bioinformatics. Reusing partial answers beats starting from scratch.",
      },
    ],
  },
  {
    slide: "### Core intuition\nOverlapping subproblems",
    narration: [
      {
        speaker: "m",
        text:
          "DP pays off when the same small question appears repeatedly. We capture a clear ‘state’, define base cases, and ensure each state is solved once.",
      },
      {
        speaker: "f",
        text:
          "It’s like hiking with cairns. Mark each tricky fork once, then every traveler benefits from that marker without re‑exploring the whole trail.",
      },
    ],
  },
  {
    slide: "### Two friendly styles\nMemoization vs. Tabulation",
    narration: [
      {
        speaker: "m",
        text:
          "Top‑down memoization caches answers to recursive calls. Bottom‑up tabulation fills a small table from simple to harder cases. Both reuse results; only the direction differs.",
      },
      {
        speaker: "f",
        text:
          "Memoization feels like asking a friend, ‘Have we seen this exact puzzle?’ Tabulation is packing your bag in order—socks before shoes—so each step is ready for the next.",
      },
    ],
  },
  {
    slide: "### Today’s path\nWarm‑up → Ideas → Practice",
    narration: [
      {
        speaker: "m",
        text:
          "We’ll start with a warm‑up quiz, review two idea cards, then practice with Coin Change (combinations) and Decode Ways (string DP). A final review locks it in.",
      },
      {
        speaker: "f",
        text:
          "You’ll see the same rhythm: define the state, set tiny base cases, and write a transition that reuses what you already know.",
      },
    ],
  },
  {
    slide: "### Two examples\nCoin Change · Decode Ways",
    narration: [
      {
        speaker: "m",
        text:
          "In Coin Change, we count combinations by iterating coins on the outside so order doesn’t inflate the count. In Decode Ways, we step through a string and combine 1‑ and 2‑digit choices while handling zeros carefully.",
      },
      {
        speaker: "f",
        text:
          "If Coin Change is arranging bills to reach a total, Decode Ways is reading a secret note where characters can pair up. The table keeps both stories consistent.",
      },
    ],
  },
];

const OUTRO_MEDIA_SEGMENTS: MediaSegment[] = [
  {
    slide: "## Wrap‑up\nDP in one breath",
    narration: [
      {
        speaker: "m",
        text:
          "DP is about naming the state, anchoring with base cases, and reusing computed answers via a memo or table. Today you applied that to Coin Change and Decode Ways.",
      },
      {
        speaker: "f",
        text:
          "Keep the mental checklist: What’s the state? What’s the tiniest known answer? How do small answers compose into the next one?",
      },
    ],
  },
  {
    slide: "### What sticks\nHabits, not formulas",
    narration: [
      {
        speaker: "m",
        text:
          "Spot overlapping subproblems early. Prefer clear states and minimal memory. Choose memoization or tabulation for clarity—both are valid.",
      },
      {
        speaker: "f",
        text:
          "Like organizing tools in a small box: only keep what you reach for. The structure makes the next fix faster.",
      },
    ],
  },
  {
    slide: "### Next steps\nPractice and explore",
    narration: [
      {
        speaker: "m",
        text:
          "When you’re ready, try more DP patterns—stairs and grids, LIS, or knapsack. Short, focused reps will cement the skill.",
      },
      {
        speaker: "f",
        text:
          "One more small session now beats a long one later. See you in the next lesson.",
      },
    ],
  },
];

const MEDIA_SOURCES: Array<{
  planItemId: string;
  fileName: string;
  segments: MediaSegment[];
}> = [
  {
    planItemId: INTRO_PLAN_ITEM_ID,
    fileName: INTRO_AUDIO_FILE,
    segments: INTRO_MEDIA_SEGMENTS,
  },
  {
    planItemId: OUTRO_PLAN_ITEM_ID,
    fileName: OUTRO_AUDIO_FILE,
    segments: OUTRO_MEDIA_SEGMENTS,
  },
];

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
      id: INTRO_PLAN_ITEM_ID,
      kind: "media",
      title: "Kick-off briefing",
      icon: "🎧",
      meta: "Start here",
      summary:
        "Preview the journey and set the rhythm before the quizzes and drills.",
    },
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
    {
      id: OUTRO_PLAN_ITEM_ID,
      kind: "media",
      title: "Cool-down recap",
      icon: "🎧",
      meta: "Wrap-up",
      summary:
        "Wind down with the key habits to carry into your next dynamic programming session.",
    },
  ];
}

function normalizeBucketName(raw: string | undefined): string {
  if (!raw) {
    return "";
  }
  return raw
    .trim()
    .replace(/^gs:\/\//i, "")
    .replace(/^https:\/\/storage\.googleapis\.com\//i, "")
    .replace(/^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\//i, "")
    .replace(/\/.*$/, "");
}

function resolveStorageBucket(): string {
  const sources = [
    process.env.FIREBASE_STORAGE_BUCKET,
    process.env.STORAGE_BUCKET,
    process.env.GCLOUD_STORAGE_BUCKET,
  ];
  const bucketFromEnv = sources
    .map((candidate) => normalizeBucketName(candidate))
    .find((value) => value.length > 0);
  if (bucketFromEnv) {
    return bucketFromEnv;
  }

  const serviceAccountRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountRaw && serviceAccountRaw.trim().length > 0) {
    try {
      const serviceAccount = parseFirebaseServiceAccount(serviceAccountRaw);
      if (serviceAccount.projectId) {
        return `${serviceAccount.projectId}.firebasestorage.app`;
      }
    } catch (error) {
      console.warn("Failed to derive storage bucket from GOOGLE_SERVICE_ACCOUNT_JSON", error);
    }
  }

  throw new Error(
    "FIREBASE_STORAGE_BUCKET (or STORAGE_BUCKET) must be provided to publish media assets.",
  );
}

type FlattenedLine = {
  slideIndex: number;
  text: string;
};

function distributeDurations(
  segments: MediaSegment[],
  totalDurationSec: number,
): {
  lineOffsets: number[];
  lineDurations: number[];
  slideOffsets: number[];
  slideDurations: number[];
} {
  const flattened: FlattenedLine[] = [];
  segments.forEach((segment, slideIndex) => {
    segment.narration.forEach((line) => {
      flattened.push({
        slideIndex,
        text: line.text,
      });
    });
  });

  const lineCount = flattened.length;
  if (lineCount === 0) {
    return {
      lineOffsets: [],
      lineDurations: [],
      slideOffsets: segments.map(() => 0),
      slideDurations: segments.map(() => 0),
    };
  }

  const fallbackTotal = Math.max(lineCount * FALLBACK_LINE_DURATION_SEC, MIN_LINE_DURATION_SEC * lineCount);
  const totalDuration = Number.isFinite(totalDurationSec) && totalDurationSec > 0
    ? totalDurationSec
    : fallbackTotal;

  const weights = flattened.map(({ text }) => {
    const words = text.split(/\s+/).filter(Boolean).length;
    return Math.max(words, 3);
  });
  const totalWeight = weights.reduce((acc, value) => acc + value, 0);

  const baseDurations = weights.map((weight) => {
    if (totalWeight === 0) {
      return FALLBACK_LINE_DURATION_SEC;
    }
    return (totalDuration * weight) / totalWeight;
  });

  const minimallyBounded = baseDurations.map((duration) =>
    Math.max(duration, MIN_LINE_DURATION_SEC),
  );

  const boundedSum = minimallyBounded.reduce((acc, value) => acc + value, 0);
  const normalisationFactor = boundedSum > 0 ? totalDuration / boundedSum : 1;
  const adjustedDurations = minimallyBounded.map((duration) => duration * normalisationFactor);

  const round = (value: number) => Math.max(0, Math.round(value * 1000) / 1000);
  const normalizedDurations = (() => {
    const rawDurations: number[] = [];
    let cursor = 0;
    adjustedDurations.forEach((duration) => {
      rawDurations.push(duration);
      cursor += duration;
    });
    const correction = totalDuration - cursor;
    if (rawDurations.length > 0) {
      rawDurations[rawDurations.length - 1] += correction;
    }
    return rawDurations;
  })();

  let roundedDurations = normalizedDurations.map(round);

  const recomputeOffsets = (durations: number[]): number[] => {
    const offsets: number[] = [];
    let running = 0;
    durations.forEach((duration) => {
      offsets.push(round(running));
      running += duration;
    });
    return offsets;
  };

  let roundedOffsets = recomputeOffsets(roundedDurations);

  const roundedSum = roundedDurations.reduce((acc, value) => acc + value, 0);
  const roundedCorrection = round(totalDuration - roundedSum);
  if (roundedDurations.length > 0 && Math.abs(roundedCorrection) > 0.001) {
    const updatedLast = Math.max(
      MIN_LINE_DURATION_SEC,
      roundedDurations[roundedDurations.length - 1] + roundedCorrection,
    );
    roundedDurations[roundedDurations.length - 1] = round(updatedLast);
    roundedOffsets = recomputeOffsets(roundedDurations);
  }

  const slideOffsets = new Array(segments.length).fill(0);
  const slideDurations = new Array(segments.length).fill(0);
  const hasSlideStart = new Array(segments.length).fill(false);

  roundedDurations.forEach((duration, index) => {
    const { slideIndex } = flattened[index]!;
    if (!hasSlideStart[slideIndex]) {
      slideOffsets[slideIndex] = roundedOffsets[index] ?? 0;
      hasSlideStart[slideIndex] = true;
    }
    slideDurations[slideIndex] += duration;
  });

  // Guard against uninitialised slides (e.g., narration missing)
  slideOffsets.forEach((offset, index) => {
    if (!hasSlideStart[index]) {
      slideOffsets[index] = index === 0 ? 0 : slideOffsets[index - 1] + slideDurations[index - 1];
    }
  });

  return {
    lineOffsets: roundedOffsets,
    lineDurations: roundedDurations,
    slideOffsets: slideOffsets.map((value) => Math.round(value * 1000) / 1000),
    slideDurations: slideDurations.map((value) => Math.round(value * 1000) / 1000),
  };
}

async function buildAudioResultFromFile(
  audioFilePath: string,
  segments: MediaSegment[],
): Promise<SessionAudioResult> {
  const stats = await fs.stat(audioFilePath);
  const flattenedLineCount = segments.reduce(
    (acc, segment) => acc + segment.narration.length,
    0,
  );

  const approximateDuration =
    stats.size > 0 ? (stats.size * 8) / 128_000 : 0; // assume ~128kbps
  const fallbackDuration = Math.max(
    flattenedLineCount * FALLBACK_LINE_DURATION_SEC,
    MIN_LINE_DURATION_SEC * flattenedLineCount,
  );
  const totalDurationSec = Math.max(approximateDuration, fallbackDuration);

  const { lineOffsets, lineDurations, slideOffsets, slideDurations } = distributeDurations(
    segments,
    totalDurationSec,
  );

  return {
    outputFilePath: audioFilePath,
    outputMimeType: AUDIO_MIME_TYPE,
    totalDurationSec,
    segmentOffsets: lineOffsets,
    segmentDurations: lineDurations,
    sampleRate: DEFAULT_SAMPLE_RATE,
    channels: DEFAULT_CHANNELS,
    totalBytes: stats.size,
    segmentFiles: [],
    slideOffsets,
    slideDurations,
    lineOffsets,
    lineDurations,
  };
}

async function publishMediaAssets(userId: string, sessionId: string): Promise<void> {
  const storageBucket = resolveStorageBucket();

  for (const source of MEDIA_SOURCES) {
    const audioFilePath = path.join(WORKSPACE_PATHS.codeAudioDir, source.fileName);
    try {
      await fs.access(audioFilePath);
    } catch (error) {
      throw new Error(
        `Audio file not found for plan item ${source.planItemId}: ${audioFilePath}`,
      );
    }

    const audioResult = await buildAudioResultFromFile(audioFilePath, source.segments);

    await publishSessionMediaClip({
      userId,
      sessionId,
      planItemId: source.planItemId,
      segments: source.segments,
      audio: audioResult,
      storageBucket,
    });

    console.log(
      `Published media ${source.planItemId} from ${audioFilePath} (${audioResult.totalDurationSec.toFixed(1)}s)`,
    );
  }
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
  ensureEvalEnvLoaded();
  const userId = getTestUserId();
  const sessionId = TEST_SESSION_ID;

  const sessionData = {
    id: sessionId,
    title: TEST_SESSION_TITLE,
    createdAt: Timestamp.now(),
    plan: buildPlan(),
  } satisfies z.input<typeof SessionSchema>;

  const session = SessionSchema.parse(sessionData);

  const userRef = await seedContent(userId, session);

  await userRef.collection("sessions").doc(session.id).set(sessionData);
  await publishMediaAssets(userId, session.id);
  await userRef.set({ currentSessionId: session.id }, { merge: true });

  console.log(`Created session ${session.id} for test user ${userId}`);
}

main().catch((error) => {
  console.error("Failed to generate test session", error);
  process.exit(1);
});
