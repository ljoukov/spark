import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Command, Option } from "commander";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { getFirebaseAdminFirestore, getGoogleServiceAccount } from "@spark/llm";
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

import { ensureEvalEnvLoaded, WORKSPACE_PATHS } from "../utils/paths";
import {
  createConsoleProgress,
  synthesizeAndPublishNarration,
} from "@spark/llm/code/generateNarration";
import { generateStory, type GenerateStoryResult } from "@spark/llm/code/generateStory";
import { validateProblems, ProblemValidationError } from "@spark/llm/code/problemValidation";
import { runJobsWithConcurrency } from "@spark/llm/utils/concurrency";

const TEMPLATE_USER_ID = "welcome-templates";
const TEMPLATE_ROOT_COLLECTION = "spark-admin";
const TEMPLATE_ROOT_DOC = "templates";
const TEMPLATE_SESSIONS_COLLECTION = "sessions";

const MEDIA_SOURCES: Array<{
  sessionId: string;
  planItemId: string;
  segments: Parameters<typeof synthesizeAndPublishNarration>[0]["segments"];
}> = [];

type WelcomeSessionBlueprint = {
  sessionId: string;
  key: string;
  title: string;
  tagline: string;
  emoji: string;
  topic: string;
  storyPlanItemId: string;
  buildPlan: (storyTitle: string) => PlanItem[];
  quizzes: QuizDefinition[];
  problems: CodeProblem[];
};

type WelcomeSessionContext = {
  storyResult?: GenerateStoryResult;
  problems?: CodeProblem[];
  session?: Session;
  sessionData?: z.input<typeof SessionSchema> & {
    tagline: string;
    emoji: string;
    topic: string;
    key: string;
  };
};

type RuntimeConfig = {
  userId: string;
  storageBucket: string;
  debugRootBaseDir: string;
};

const BFS_QUIZZES: QuizDefinition[] = [
  {
    id: "bfs-primer-quiz",
    title: "Level Quest: Start Here",
    topic: "Breadth-first Search",
    estimatedMinutes: 6,
    progressKey: "primer",
    description:
      "Ten gentle steps that introduce level-by-level searching and give quick practice for the problems.",
    questions: [
      {
        kind: "info-card",
        id: "bfs-primer-card-1",
        prompt: "A Calm Explorer",
        eyebrow: "Story",
        body: [
          "**Imagine** a park filled with rope bridges between treehouses where each crossing takes the same time.",
          "",
          "- Explore every treehouse one step away before touching the next layer.",
          "- Then visit the wave two steps away, keeping the journey orderly.",
          "",
          "The first time you reach the Snack Shack you know it was the shortest hop count.",
        ].join("\n"),
        continueLabel: "Next idea",
      },
      {
        kind: "info-card",
        id: "bfs-primer-card-2",
        prompt: "Levels Keep Us Oriented",
        eyebrow: "Levels",
        body: [
          "Think of each wave as a level:",
          "",
          "- Level 0 is the starting spot.",
          "- Level 1 holds every room one step away.",
          "- Level 2 collects rooms two steps away, and so on.",
          "",
          "_Finishing a level before touching the next one protects the shortest-path promise._",
        ].join("\n"),
        continueLabel: "Got it",
      },
      {
        kind: "info-card",
        id: "bfs-primer-card-3",
        prompt: "Queues = Fair Lines",
        eyebrow: "Tool",
        body: [
          "A queue acts like a fair line at a theme park: whoever joins first gets served first.",
          "",
          "- Discover new neighbours? add them to the back.",
          "- Pop from the front to process the next room.",
          "",
          "That rhythm keeps the levels tidy without extra bookkeeping.",
        ].join("\n"),
        continueLabel: "Let's try it",
      },
      {
        kind: "multiple-choice",
        id: "bfs-primer-promise",
        prompt:
          "What promise does Breadth-first Search keep when every bridge takes the same time?",
        hint: "Think about how we finish one distance before moving to the next.",
        explanation:
          "Because we explore level by level, the first time we reach the goal is after the fewest possible steps.",
        options: [
          {
            id: "A",
            label: "A",
            text: "It always visits every room before stopping",
          },
          {
            id: "B",
            label: "B",
            text: "It reaches the goal using the fewest steps possible",
          },
          {
            id: "C",
            label: "C",
            text: "It chooses the room with the biggest number first",
          },
          {
            id: "D",
            label: "D",
            text: "It skips any room that has more than two bridges",
          },
        ],
        correctOptionId: "B",
        correctFeedback: {
          heading: "Nice work",
          message:
            "Exploring level by level guarantees the very first path to the goal is one of the shortest ones.",
        },
      },
      {
        kind: "type-answer",
        id: "bfs-primer-queue",
        prompt:
          "Name the data structure we use to keep the next places to visit lined up in Breadth-first Search.",
        hint: "It behaves like a line at a theme park: first in, first out.",
        explanation:
          "We use a queue so the earliest discoveries get explored first, keeping the levels in order.",
        answer: "queue",
        acceptableAnswers: ["Queue", "a queue"],
        correctFeedback: {
          heading: "You got it",
          message: "A queue keeps the exploration fair and level by level.",
        },
      },
      {
        kind: "multiple-choice",
        id: "bfs-primer-neighbours",
        prompt:
          "You visit room 4 and discover new neighbours 6 and 7 that were never seen before. What should you do next?",
        hint: "Remember how the queue grows.",
        explanation:
          "Mark the neighbours as visited, enqueue them, and later explore them when they reach the front.",
        options: [
          {
            id: "A",
            label: "A",
            text: "Visit them right away even if the queue has other rooms",
          },
          {
            id: "B",
            label: "B",
            text: "Ignore them until every other room has been processed",
          },
          {
            id: "C",
            label: "C",
            text: "Add them to the back of the queue and keep going",
          },
          {
            id: "D",
            label: "D",
            text: "Delete room 4 so it cannot appear again",
          },
        ],
        correctOptionId: "C",
        correctFeedback: {
          heading: "Exactly",
          message:
            "Adding new neighbours to the back of the queue keeps the exploration neat and level based.",
        },
      },
      {
        kind: "multiple-choice",
        id: "bfs-primer-order",
        prompt: [
          "Rooms are connected like this:",
          "• 1 connects to 2 and 3 (in that order).",
          "• 2 connects to 4.",
          "• 3 connects to 5.",
          "",
          "Starting from room 1 and adding neighbours in ascending order, what visiting order does Breadth-first Search produce?",
        ].join("\n"),
        hint: "Follow the queue: start with 1, then its neighbours, then their neighbours.",
        explanation:
          "We visit 1 first, then 2 and 3, then 4 from 2, then 5 from 3, so the order is 1, 2, 3, 4, 5.",
        options: [
          { id: "A", label: "A", text: "1 → 2 → 4 → 3 → 5" },
          { id: "B", label: "B", text: "1 → 3 → 2 → 5 → 4" },
          { id: "C", label: "C", text: "1 → 2 → 3 → 4 → 5" },
          { id: "D", label: "D", text: "1 → 4 → 2 → 3 → 5" },
        ],
        correctOptionId: "C",
        correctFeedback: {
          heading: "Queue power",
          message:
            "Level 1 has rooms 2 and 3, so we finish them before moving deeper to 4 and 5.",
        },
      },
      {
        kind: "type-answer",
        id: "bfs-primer-level-word",
        prompt:
          "What word do we use for the group of rooms that are the same number of steps away from the start?",
        hint: "We number them 0, 1, 2, … as we explore.",
        explanation:
          "Breadth-first Search organises the map into levels that measure distance from the start.",
        answer: "level",
        acceptableAnswers: ["levels", "Layer", "layer", "layers"],
        correctFeedback: {
          heading: "Nice vocabulary",
          message:
            "Calling them levels helps us explain how far each room is from the start.",
        },
      },
      {
        kind: "multiple-choice",
        id: "bfs-primer-distance",
        prompt:
          "Using the room map from the previous question, how many steps does Breadth-first Search need to reach room 5 from room 1?",
        hint: "Count the edges along the first path that reaches room 5.",
        explanation: "The first path to room 5 is 1 → 3 → 5, which is 2 steps.",
        options: [
          { id: "A", label: "A", text: "1" },
          { id: "B", label: "B", text: "2" },
          { id: "C", label: "C", text: "3" },
          { id: "D", label: "D", text: "4" },
        ],
        correctOptionId: "B",
        correctFeedback: {
          heading: "Shortest path found",
          message:
            "Level 2 holds room 5, so the shortest distance from room 1 is 2 steps.",
        },
      },
      {
        kind: "multiple-choice",
        id: "bfs-primer-grid",
        prompt: [
          "Consider this 3×3 map (S = start, T = goal, # = wall):",
          "S . .",
          ". # #",
          ". . T",
          "",
          "Moving only up, down, left, or right, how many steps does Breadth-first Search count along the shortest path from S to T?",
        ].join("\n"),
        hint: "Wave outwards from S while skipping the walls.",
        explanation:
          "The best route is S → (1,0) → (2,0) → (2,1) → T, which is 4 steps.",
        options: [
          { id: "A", label: "A", text: "2" },
          { id: "B", label: "B", text: "3" },
          { id: "C", label: "C", text: "4" },
          { id: "D", label: "D", text: "5" },
        ],
        correctOptionId: "C",
        correctFeedback: {
          heading: "Nicely mapped",
          message:
            "Breadth-first Search reaches the goal after four moves once it travels around the walls.",
        },
      },
    ],
  },
  {
    id: "bfs-wrapup-quiz",
    title: "Level Quest Wrap-up",
    topic: "Breadth-first Search",
    estimatedMinutes: 4,
    progressKey: "wrap",
    description:
      "Seven quick moments to confirm you can steer Breadth-first Search on graphs and grids.",
    questions: [
      {
        kind: "multiple-choice",
        id: "bfs-wrap-marking",
        prompt:
          "When should you mark a room as visited during Breadth-first Search?",
        hint: "Decide whether to mark on enqueue or dequeue.",
        explanation:
          "Marking a room as visited as soon as you enqueue it stops duplicates from being added later.",
        options: [
          {
            id: "A",
            label: "A",
            text: "Only after removing it from the queue",
          },
          {
            id: "B",
            label: "B",
            text: "As soon as you add it to the queue",
          },
          {
            id: "C",
            label: "C",
            text: "Only after all of its neighbours are processed",
          },
          {
            id: "D",
            label: "D",
            text: "Never—marks are not needed",
          },
        ],
        correctOptionId: "B",
        correctFeedback: {
          heading: "Perfect timing",
          message:
            "Marking on enqueue prevents a room from being added twice, keeping the queue slim.",
        },
      },
      {
        kind: "multiple-choice",
        id: "bfs-wrap-distance",
        prompt:
          "You dequeue the goal room with distance 5. What does that number mean?",
        hint: "Think about the levels we counted.",
        explanation:
          "The distance equals the length of the shortest path from the start to the goal.",
        options: [
          {
            id: "A",
            label: "A",
            text: "The total number of rooms in the entire map",
          },
          {
            id: "B",
            label: "B",
            text: "The fewest steps from the start to the goal",
          },
          {
            id: "C",
            label: "C",
            text: "How many neighbours the goal has",
          },
          {
            id: "D",
            label: "D",
            text: "A random counter that keeps increasing",
          },
        ],
        correctOptionId: "B",
        correctFeedback: {
          heading: "Shortest confirmed",
          message:
            "As soon as the goal leaves the queue we know its recorded distance is the shortest route.",
        },
      },
      {
        kind: "type-answer",
        id: "bfs-wrap-impossible",
        prompt:
          "If Breadth-first Search never reaches the treasure, what number should the program print to show it is impossible?",
        hint: "Use the value promised in both practice problems.",
        explanation:
          "Both practice tasks use -1 to mean the goal cannot be reached.",
        answer: "-1",
        acceptableAnswers: ["-1"],
        correctFeedback: {
          heading: "Clear signal",
          message:
            "Printing -1 tells the reader instantly that no path exists.",
        },
      },
      {
        kind: "multiple-choice",
        id: "bfs-wrap-grid-walls",
        prompt:
          "On a grid map, what should you do when the next cell is a wall (#)?",
        hint: "Decide whether walls belong in the queue.",
        explanation:
          "Walls block movement, so we skip them and never place them in the queue.",
        options: [
          {
            id: "A",
            label: "A",
            text: "Treat it like an open cell and enqueue it",
          },
          {
            id: "B",
            label: "B",
            text: "Skip it and look at the next direction",
          },
          {
            id: "C",
            label: "C",
            text: "Turn it into the new start location",
          },
          {
            id: "D",
            label: "D",
            text: "Erase the wall and keep exploring through it",
          },
        ],
        correctOptionId: "B",
        correctFeedback: {
          heading: "Right choice",
          message: "Only open cells get enqueued, so walls are simply ignored.",
        },
      },
      {
        kind: "multiple-choice",
        id: "bfs-wrap-track",
        prompt:
          "Which simple plan keeps track of how many steps it took to reach each room?",
        hint: "Think about using an array or storing pairs.",
        explanation:
          "Store a distance array and set distance[neighbour] = distance[current] + 1 when you enqueue the neighbour.",
        options: [
          {
            id: "A",
            label: "A",
            text: "Keep a single global counter that increases every loop turn",
          },
          {
            id: "B",
            label: "B",
            text: "Store a distance array updated when neighbours are enqueued",
          },
          {
            id: "C",
            label: "C",
            text: "Only count the rooms on level 0",
          },
          {
            id: "D",
            label: "D",
            text: "Guess the distance after the search ends",
          },
        ],
        correctOptionId: "B",
        correctFeedback: {
          heading: "Distance locked in",
          message:
            "Updating the distance as you enqueue each neighbour keeps the steps accurate.",
        },
      },
      {
        kind: "multiple-choice",
        id: "bfs-wrap-setup",
        prompt:
          "Before starting Breadth-first Search on rooms numbered 1…N, what setup keeps the algorithm steady?",
        hint: "Think about the queue and visited arrays.",
        explanation:
          "Place the start room in the queue, set its distance to 0, and mark it visited before the loop begins.",
        options: [
          {
            id: "A",
            label: "A",
            text: "Leave the queue empty and hope neighbours appear later",
          },
          {
            id: "B",
            label: "B",
            text: "Enqueue the start room, mark it visited, and set distance 0",
          },
          {
            id: "C",
            label: "C",
            text: "Fill the queue with every room at once",
          },
          {
            id: "D",
            label: "D",
            text: "Only mark the goal as visited at the beginning",
          },
        ],
        correctOptionId: "B",
        correctFeedback: {
          heading: "Ready to explore",
          message:
            "With the start room enqueued and marked, the loop can expand outward safely.",
        },
      },
      {
        kind: "info-card",
        id: "bfs-wrap-summary",
        prompt: "Great work!",
        eyebrow: "Recap",
        body: [
          "Breadth-first Search wins by exploring in levels: queue up neighbours, mark them as soon as you add them, and record their distances.",
          "",
          "Those habits let you solve both of today’s practice problems—maps of rooms and grids—without ever getting lost.",
        ].join("\n"),
        continueLabel: "Ready for more",
      },
    ],
  },
];

const BFS_PARK_STEPS_EXAMPLES = [
  {
    title: "Example 1",
    input: ["5 5", "1 2", "1 3", "2 4", "3 4", "4 5", "1 5"].join("\n"),
    output: "3",
    explanation: "One shortest walk is 1 → 3 → 4 → 5, which uses 3 bridges.",
  },
  {
    title: "Example 2",
    input: ["4 2", "1 2", "3 4", "1 4"].join("\n"),
    output: "-1",
    explanation:
      "Spot 4 is cut off from spot 1, so there is no route and we print -1.",
  },
  {
    title: "Example 3",
    input: ["3 2", "1 2", "2 3", "2 2"].join("\n"),
    output: "0",
    explanation:
      "The start and goal are the same spot, so the answer is 0 steps.",
  },
];

const BFS_PARK_STEPS_TESTS = [
  {
    input: BFS_PARK_STEPS_EXAMPLES[0].input,
    output: BFS_PARK_STEPS_EXAMPLES[0].output,
    explanation: BFS_PARK_STEPS_EXAMPLES[0].explanation,
  },
  {
    input: BFS_PARK_STEPS_EXAMPLES[1].input,
    output: BFS_PARK_STEPS_EXAMPLES[1].output,
    explanation: BFS_PARK_STEPS_EXAMPLES[1].explanation,
  },
  {
    input: BFS_PARK_STEPS_EXAMPLES[2].input,
    output: BFS_PARK_STEPS_EXAMPLES[2].output,
    explanation: BFS_PARK_STEPS_EXAMPLES[2].explanation,
  },
  {
    input: ["1 0", "1 1"].join("\n"),
    output: "0",
    explanation: "Only one spot exists, so staying put takes 0 bridges.",
  },
  {
    input: ["2 1", "1 2", "1 2"].join("\n"),
    output: "1",
    explanation: "A single bridge links spot 1 to spot 2.",
  },
  {
    input: ["5 4", "1 2", "2 3", "3 4", "4 5", "1 5"].join("\n"),
    output: "4",
    explanation: "The only route is the chain 1 → 2 → 3 → 4 → 5.",
  },
  {
    input: ["5 6", "1 2", "2 3", "3 4", "4 5", "1 3", "2 5", "1 5"].join("\n"),
    output: "2",
    explanation: "Breadth-first Search finds the shortcut 1 → 2 → 5.",
  },
  {
    input: ["5 3", "1 2", "2 3", "4 5", "1 5"].join("\n"),
    output: "-1",
    explanation: "Spots 1–3 form a component that never reaches spot 5.",
  },
  {
    input: ["6 6", "1 2", "1 3", "2 4", "3 5", "4 6", "5 6", "1 6"].join("\n"),
    output: "3",
    explanation: "Shortest path is 1 → 2 → 4 → 6 (three bridges).",
  },
  {
    input: ["7 6", "1 2", "2 3", "3 4", "4 5", "5 6", "6 7", "4 4"].join("\n"),
    output: "0",
    explanation: "Start and goal are the same numbered spot.",
  },
];

const BFS_MAZE_SCOUT_EXAMPLES = [
  {
    title: "Example 1",
    input: ["3 3", "S..", ".##", "..T"].join("\n"),
    output: "4",
    explanation: "One shortest walk is S → (1,0) → (2,0) → (2,1) → T.",
  },
  {
    title: "Example 2",
    input: ["3 3", "S#T", "###", "..."].join("\n"),
    output: "-1",
    explanation: "Walls block every route to T, so the answer is -1.",
  },
  {
    title: "Example 3",
    input: ["4 5", "S...#", ".#.#.", ".#..T", "....."].join("\n"),
    output: "6",
    explanation:
      "Breadth-first Search weaves through the open cells and reaches T in 6 steps.",
  },
];

const BFS_MAZE_SCOUT_TESTS = [
  {
    input: BFS_MAZE_SCOUT_EXAMPLES[0].input,
    output: BFS_MAZE_SCOUT_EXAMPLES[0].output,
    explanation: BFS_MAZE_SCOUT_EXAMPLES[0].explanation,
  },
  {
    input: BFS_MAZE_SCOUT_EXAMPLES[1].input,
    output: BFS_MAZE_SCOUT_EXAMPLES[1].output,
    explanation: BFS_MAZE_SCOUT_EXAMPLES[1].explanation,
  },
  {
    input: BFS_MAZE_SCOUT_EXAMPLES[2].input,
    output: BFS_MAZE_SCOUT_EXAMPLES[2].output,
    explanation: BFS_MAZE_SCOUT_EXAMPLES[2].explanation,
  },
  {
    input: ["1 2", "ST"].join("\n"),
    output: "1",
    explanation: "Moving right once reaches the treasure immediately.",
  },
  {
    input: ["2 2", "S#", "#T"].join("\n"),
    output: "-1",
    explanation: "Walls block every possible move toward T.",
  },
  {
    input: ["3 4", "S..#", ".#..", "..T."].join("\n"),
    output: "4",
    explanation: "We weave around the walls in four moves.",
  },
  {
    input: ["4 4", "S..#", ".#.#", "...#", "..T."].join("\n"),
    output: "5",
    explanation: "A narrow corridor guides the scout to T in five steps.",
  },
  {
    input: ["5 5", "S....", "#####", "....#", "#..#.", "..T.."].join("\n"),
    output: "-1",
    explanation: "The solid wall row traps S away from T.",
  },
  {
    input: ["4 3", "S..", ".#.", ".#.", "..T"].join("\n"),
    output: "5",
    explanation: "The scout must detour down the left column before turning.",
  },
  {
    input: ["5 5", "S#...", ".#.#.", "..#..", ".##.#", "...T."].join("\n"),
    output: "7",
    explanation: "Seven careful moves wind through the maze to reach T.",
  },
];

const BFS_PROBLEMS: CodeProblem[] = [
  {
    slug: "park-steps",
    title: "Park Steps",
    difficulty: "easy",
    topics: ["Breadth-first Search", "Graphs"],
    description: [
      "You are planning a mini treasure hunt around the park. There are N numbered meeting spots connected by M two-way paths of equal length.",
      "",
      "Starting at spot s, print the fewest paths needed to reach spot t. If the goal is unreachable, print -1.",
    ].join("\n"),
    inputFormat: [
      "- Line 1: integers N and M — the number of spots and the number of paths.",
      "- Lines 2..(M+1): each line has two integers u v describing a two-way path between spots u and v.",
      "- Line M+2: integers s and t — the start and goal spots.",
    ].join("\n"),
    constraints: ["1 ≤ N ≤ 10_000", "0 ≤ M ≤ 20_000", "1 ≤ u, v, s, t ≤ N"],
    examples: BFS_PARK_STEPS_EXAMPLES,
    tests: BFS_PARK_STEPS_TESTS,
    hints: [
      "Build an adjacency list so you can see every neighbour quickly.",
      "Run Breadth-first Search from the start spot while storing distances in an array.",
      "If the goal never receives a distance, output -1; otherwise output its distance.",
    ],
    solution: {
      language: "python",
      code: [
        "import sys",
        "from collections import deque",
        "",
        "data = sys.stdin.read().strip().split()",
        "if not data:",
        "    sys.exit(0)",
        "it = iter(data)",
        "n = int(next(it))",
        "m = int(next(it))",
        "adjacency = [[] for _ in range(n + 1)]",
        "for _ in range(m):",
        "    u = int(next(it))",
        "    v = int(next(it))",
        "    adjacency[u].append(v)",
        "    adjacency[v].append(u)",
        "start = int(next(it))",
        "goal = int(next(it))",
        "for neighbours in adjacency:",
        "    neighbours.sort()",
        "",
        "distance = [-1] * (n + 1)",
        "queue = deque([start])",
        "distance[start] = 0",
        "while queue:",
        "    current = queue.popleft()",
        "    if current == goal:",
        "        break",
        "    for neighbour in adjacency[current]:",
        "        if distance[neighbour] == -1:",
        "            distance[neighbour] = distance[current] + 1",
        "            queue.append(neighbour)",
        "",
        "print(distance[goal])",
      ].join("\n"),
    },
    metadataVersion: 2,
  },
  {
    slug: "maze-scout",
    title: "Maze Scout",
    difficulty: "easy",
    topics: ["Breadth-first Search", "Grids"],
    description: [
      "You are holding a simple map with R rows and C columns. 'S' marks your starting square, 'T' marks the treasure, '.' is open ground, and '#' is a wall.",
      "",
      "Move up, down, left, or right. Print the fewest moves needed to reach T. If the treasure cannot be reached, print -1.",
    ].join("\n"),
    inputFormat: [
      "- Line 1: integers R and C — the number of rows and columns.",
      "- Lines 2..(R+1): each line is a string of length C containing characters '.', '#', 'S', or 'T'.",
    ].join("\n"),
    constraints: [
      "1 ≤ R, C ≤ 200",
      "Exactly one 'S' and one 'T' appear in the grid.",
    ],
    examples: BFS_MAZE_SCOUT_EXAMPLES,
    tests: BFS_MAZE_SCOUT_TESTS,
    hints: [
      "Start Breadth-first Search at the square marked 'S'.",
      "Track visited squares in a 2D array so each open cell joins the queue at most once.",
      "Store the distance with each square (or keep a distance grid) and add 1 for every step to a neighbour.",
    ],
    solution: {
      language: "python",
      code: [
        "import sys",
        "from collections import deque",
        "",
        "lines = sys.stdin.read().splitlines()",
        "if not lines:",
        "    sys.exit(0)",
        "rows, cols = map(int, lines[0].split())",
        "grid = [list(line.strip()) for line in lines[1 : rows + 1]]",
        "",
        "start = None",
        "goal = None",
        "for r in range(rows):",
        "    for c in range(cols):",
        "        if grid[r][c] == 'S':",
        "            start = (r, c)",
        "        elif grid[r][c] == 'T':",
        "            goal = (r, c)",
        "",
        "if start is None or goal is None:",
        "    print(-1)",
        "    sys.exit(0)",
        "",
        "directions = [(-1, 0), (1, 0), (0, -1), (0, 1)]",
        "queue = deque([start])",
        "visited = [[False] * cols for _ in range(rows)]",
        "distance = [[-1] * cols for _ in range(rows)]",
        "sr, sc = start",
        "visited[sr][sc] = True",
        "distance[sr][sc] = 0",
        "",
        "while queue:",
        "    r, c = queue.popleft()",
        "    if (r, c) == goal:",
        "        break",
        "    for dr, dc in directions:",
        "        nr, nc = r + dr, c + dc",
        "        if 0 <= nr < rows and 0 <= nc < cols:",
        "            if not visited[nr][nc] and grid[nr][nc] != '#':",
        "                visited[nr][nc] = True",
        "                distance[nr][nc] = distance[r][c] + 1",
        "                queue.append((nr, nc))",
        "",
        "gr, gc = goal",
        "print(distance[gr][gc])",
      ].join("\n"),
    },
    metadataVersion: 2,
  },
];

const DP_QUIZZES: QuizDefinition[] = [
  {
    id: "dp-primer-quiz",
    title: "Blueprint Warm-up",
    topic: "Dynamic Programming",
    estimatedMinutes: 7,
    progressKey: "primer",
    description:
      "Build the mental model for turning overlapping puzzles into reusable states and transitions.",
    questions: [
      {
        kind: "info-card",
        id: "dp-primer-card-1",
        prompt: "A Puzzle Ladder",
        eyebrow: "Story",
        body: [
          "Imagine stacking glass tiles to climb a tower. Each tile records how many ways you know how to reach that height.",
          "",
          "Dynamic programming fills the tower from the ground up by trusting the answers already written on lower tiles.",
        ].join("\n"),
        continueLabel: "Next idea",
      },
      {
        kind: "info-card",
        id: "dp-primer-card-2",
        prompt: "State -> Transition",
        eyebrow: "Blueprint",
        body: [
          "Every DP solution picks a state — the question we want a number for — and a transition — how to combine smaller states to answer it.",
          "",
          "Good states only depend on answers we have already computed, so each new value is quick to assemble.",
        ].join("\n"),
        continueLabel: "Makes sense",
      },
      {
        kind: "info-card",
        id: "dp-primer-card-3",
        prompt: "Base Cases Anchor Us",
        eyebrow: "Foundation",
        body: [
          "Base cases are the floor tiles. They set exact answers for the smallest states so the rest of the tower does not float in the air.",
          "",
          "Without base cases, the recurrence would point to undefined work. With them, every new answer has somewhere solid to stand.",
        ].join("\n"),
        continueLabel: "Ready to test",
      },
      {
        kind: "multiple-choice",
        id: "dp-primer-overlap",
        prompt:
          'Which task screams "overlapping subproblems" and begs for dynamic programming?',
        hint: "Pick the one where smaller questions repeat over and over.",
        explanation:
          "Counting ways to climb many stairs reuses the same smaller stair counts for every larger step.",
        options: [
          { id: "A", label: "A", text: "Sorting a list once with quicksort" },
          {
            id: "B",
            label: "B",
            text: "Counting how many ways to climb 20 stairs taking 1 or 2 steps",
          },
          {
            id: "C",
            label: "C",
            text: "Checking if a number is prime by trying every divisor",
          },
          {
            id: "D",
            label: "D",
            text: "Scanning a string once to see if it contains a space",
          },
        ],
        correctOptionId: "B",
        correctFeedback: {
          heading: "Exactly",
          message:
            "Every taller stair question reuses the answers for the two shorter stair heights, so memorising pays off.",
        },
      },
      {
        kind: "multiple-choice",
        id: "dp-primer-recurrence",
        prompt:
          "You store `ways[i]` as the number of ways to land on step `i` using jumps of 1 or 2. Which recurrence is correct?",
        hint: "Think about the last jump used to land on step `i`.",
        explanation:
          "To land on step `i` you either step from `i - 1` or hop from `i - 2`, so `ways[i]` is their sum.",
        options: [
          {
            id: "A",
            label: "A",
            text: "`ways[i] = ways[i - 1] * ways[i - 2]`",
          },
          {
            id: "B",
            label: "B",
            text: "`ways[i] = ways[i - 1] + ways[i - 2]`",
          },
          {
            id: "C",
            label: "C",
            text: "`ways[i] = ways[i - 1] - ways[i - 2]`",
          },
          {
            id: "D",
            label: "D",
            text: "`ways[i] = 2 * ways[i - 1]`",
          },
        ],
        correctOptionId: "B",
        correctFeedback: {
          heading: "Solid recurrence",
          message:
            "Each path to step `i` ends with a 1-step jump from `i - 1` or a 2-step jump from `i - 2`, so we add both counts.",
        },
      },
      {
        kind: "multiple-choice",
        id: "dp-primer-approach",
        prompt:
          "How do memoisation and tabulation differ when solving the same DP problem?",
        hint: "Think about recursion versus filling a table directly.",
        explanation:
          "Memoisation caches answers during recursive calls, while tabulation fills an array iteratively from the base cases up.",
        options: [
          {
            id: "A",
            label: "A",
            text: "Memoisation only works on graphs but tabulation only works on strings",
          },
          {
            id: "B",
            label: "B",
            text: "Memoisation stores answers during recursion; tabulation fills the table iteratively",
          },
          {
            id: "C",
            label: "C",
            text: "Memoisation multiplies results and tabulation adds them",
          },
          {
            id: "D",
            label: "D",
            text: "Memoisation uses less memory in every scenario",
          },
        ],
        correctOptionId: "B",
        correctFeedback: {
          heading: "Right comparison",
          message:
            "Both strategies remember answers; memoisation grows on demand while tabulation writes the table in order.",
        },
      },
      {
        kind: "type-answer",
        id: "dp-primer-tabulation",
        prompt:
          "What do we call the technique where we fill the DP table from the smallest state upward without recursion?",
        hint: 'It rhymes with "calculation" and starts with a t.',
        explanation:
          "Tabulation fills the table iteratively, always using answers that were already written.",
        answer: "tabulation",
        acceptableAnswers: ["Tabulation"],
        correctFeedback: {
          heading: "Nice vocabulary",
          message:
            "Tabulation keeps the control flow simple by growing the solution bottom-up.",
        },
      },
      {
        kind: "multiple-choice",
        id: "dp-primer-base",
        prompt:
          "When counting stair paths, what value should `ways[0]` (the empty staircase) hold?",
        hint: "How many ways exist to stay exactly where you started?",
        explanation:
          "There is exactly one way to stand still: take zero moves. Setting `ways[0] = 1` seeds the rest of the table.",
        options: [
          { id: "A", label: "A", text: "0" },
          { id: "B", label: "B", text: "1" },
          { id: "C", label: "C", text: "Depends on n" },
          { id: "D", label: "D", text: "Whatever value appears most often" },
        ],
        correctOptionId: "B",
        correctFeedback: {
          heading: "Anchored",
          message:
            "Treating the empty climb as one valid plan ensures taller stairs count properly.",
        },
      },
      {
        kind: "info-card",
        id: "dp-primer-summary",
        prompt: "Blueprint locked in",
        eyebrow: "Recap",
        body: [
          "Pick a state, write a recurrence that reuses smaller answers, anchor the base cases, and store everything in a table.",
          "",
          "Those four moves let you tame counting, optimisation, and scheduling puzzles with confidence.",
        ].join("\n"),
        continueLabel: "Onward",
      },
    ],
  },
  {
    id: "dp-wrap-quiz",
    title: "Blueprint Wrap-up",
    topic: "Dynamic Programming",
    estimatedMinutes: 5,
    progressKey: "wrap",
    description:
      "Check that you can describe the states, transitions, and memory choices used in both DP coding challenges.",
    questions: [
      {
        kind: "multiple-choice",
        id: "dp-wrap-state",
        prompt:
          "In Stair Sprint, what does `dp[i]` represent after filling the table?",
        hint: "It counts something about landing exactly on step `i`.",
        explanation:
          "`dp[i]` equals the number of distinct sequences of allowed jumps that land exactly on step `i`.",
        options: [
          {
            id: "A",
            label: "A",
            text: "The minimum number of jumps needed to reach step `i`",
          },
          {
            id: "B",
            label: "B",
            text: "The height of the tallest jump used so far",
          },
          {
            id: "C",
            label: "C",
            text: "The number of ways to reach step `i`",
          },
          {
            id: "D",
            label: "D",
            text: "Whether step `i` is broken or safe",
          },
        ],
        correctOptionId: "C",
        correctFeedback: {
          heading: "Spot on",
          message:
            "Knowing that `dp[i]` counts paths lets you reuse `dp[i - step]` for every allowed step.",
        },
      },
      {
        kind: "type-answer",
        id: "dp-wrap-subproblems",
        prompt:
          "What one-word name do we give to the smaller questions a DP solution reuses over and over?",
        hint: "They sit inside the big problem like puzzle pieces.",
        explanation:
          "We break the original challenge into subproblems so their answers can be reused.",
        answer: "subproblems",
        acceptableAnswers: ["Subproblem", "subproblem", "Subproblems"],
        correctFeedback: {
          heading: "Right term",
          message:
            "Spotting the repeating subproblems is how you know dynamic programming will help.",
        },
      },
      {
        kind: "multiple-choice",
        id: "dp-wrap-museum",
        prompt:
          "The recurrence `dp[i] = max(dp[i-1], value[i] + dp[i-2])` in Museum Guard ensures what behaviour?",
        hint: "Think about the choice to skip or take the `i`-th room.",
        explanation:
          "It compares skipping room `i` (`dp[i-1]`) with taking it and adding the best non-adjacent total (`value[i] + dp[i-2]`).",
        options: [
          {
            id: "A",
            label: "A",
            text: "We always choose the smallest numbered room",
          },
          {
            id: "B",
            label: "B",
            text: "We only look two rooms ahead and ignore the rest",
          },
          {
            id: "C",
            label: "C",
            text: "We decide whether to take room `i` while respecting the no-adjacent rule",
          },
          {
            id: "D",
            label: "D",
            text: "We alternate between taking and skipping rooms in a fixed pattern",
          },
        ],
        correctOptionId: "C",
        correctFeedback: {
          heading: "Well reasoned",
          message:
            "The recurrence keeps both possibilities and chooses the better one for room `i`.",
        },
      },
      {
        kind: "multiple-choice",
        id: "dp-wrap-memo",
        prompt:
          "When should you clear or rebuild the memo/table in these welcome exercises?",
        hint: "Consider what happens if the input instance changes.",
        explanation:
          "Each new set of inputs (different stairs or room values) needs a fresh table; reusing old entries could mix data from another puzzle.",
        options: [
          {
            id: "A",
            label: "A",
            text: "On every loop iteration, even with the same input",
          },
          {
            id: "B",
            label: "B",
            text: "Only when the input instance changes",
          },
          {
            id: "C",
            label: "C",
            text: "Never; we keep one global table for all problems",
          },
          {
            id: "D",
            label: "D",
            text: "Only if the prime modulus changes",
          },
        ],
        correctOptionId: "B",
        correctFeedback: {
          heading: "Good hygiene",
          message:
            "Clearing between input instances prevents stale answers from contaminating new runs.",
        },
      },
      {
        kind: "type-answer",
        id: "dp-wrap-memory",
        prompt:
          "In Museum Guard, how many previous DP values must you keep at any moment to update the next answer?",
        hint: "Look at the recurrence `dp[i] = max(dp[i-1], value[i] + dp[i-2])`.",
        explanation:
          "You only need `dp[i-1]` and `dp[i-2]`, so two running totals are enough.",
        answer: "2",
        acceptableAnswers: ["two", "Two"],
        correctFeedback: {
          heading: "Space saved",
          message:
            "Rolling variables for the last two values keep memory usage constant.",
        },
      },
      {
        kind: "info-card",
        id: "dp-wrap-summary",
        prompt: "DP instincts secured",
        eyebrow: "Recap",
        body: [
          "Name your state, store its base cases, choose transitions that reuse finished subproblems, and keep just the memory you need.",
          "",
          "Those instincts unlock counting paths, guarding museums, and the tougher DP adventures ahead.",
        ].join("\n"),
        continueLabel: "Got it",
      },
    ],
  },
];

const DP_STAIR_SPRINT_EXAMPLES = [
  {
    title: "Example 1",
    input: ["4 2", "1 2"].join("\n"),
    output: "5",
    explanation:
      "Paths: 1+1+1+1, 1+1+2, 1+2+1, 2+1+1, and 2+2 make five routes.",
  },
  {
    title: "Example 2",
    input: ["6 3", "1 3 5"].join("\n"),
    output: "8",
    explanation:
      "Reuse the smaller counts: ways build from step 0, 1, and 3 to reach 6 in eight combinations.",
  },
  {
    title: "Example 3",
    input: ["5 2", "2 4"].join("\n"),
    output: "0",
    explanation:
      "Every jump size is even, so you can never land exactly on odd step 5.",
  },
];

const DP_STAIR_SPRINT_TESTS = [
  {
    input: DP_STAIR_SPRINT_EXAMPLES[0].input,
    output: DP_STAIR_SPRINT_EXAMPLES[0].output,
    explanation: DP_STAIR_SPRINT_EXAMPLES[0].explanation,
  },
  {
    input: DP_STAIR_SPRINT_EXAMPLES[1].input,
    output: DP_STAIR_SPRINT_EXAMPLES[1].output,
    explanation: DP_STAIR_SPRINT_EXAMPLES[1].explanation,
  },
  {
    input: DP_STAIR_SPRINT_EXAMPLES[2].input,
    output: DP_STAIR_SPRINT_EXAMPLES[2].output,
    explanation: DP_STAIR_SPRINT_EXAMPLES[2].explanation,
  },
  {
    input: ["0 1", "3"].join("\n"),
    output: "1",
    explanation: "The empty climb has exactly one plan: take zero moves.",
  },
  { input: ["1 3", "1 2 3"].join("\n"), output: "1" },
  { input: ["10 2", "1 2"].join("\n"), output: "89" },
  { input: ["7 2", "2 3"].join("\n"), output: "3" },
  { input: ["12 3", "1 3 4"].join("\n"), output: "169" },
  { input: ["15 3", "1 5 6"].join("\n"), output: "84" },
  { input: ["25 2", "2 5"].join("\n"), output: "68" },
  { input: ["30 3", "1 2 5"].join("\n"), output: "5508222" },
];

const DP_MUSEUM_GUARD_EXAMPLES = [
  {
    title: "Example 1",
    input: ["5", "4 2 7 6 3"].join("\n"),
    output: "14",
    explanation:
      "Take rooms 1, 3, and 5 (1-indexed) for values 4 + 7 + 3 = 14 while skipping neighbours.",
  },
  {
    title: "Example 2",
    input: ["4", "5 1 1 5"].join("\n"),
    output: "10",
    explanation:
      "Guard rooms 1 and 4 for a total of 10; taking rooms 2 or 3 would block that combo.",
  },
  {
    title: "Example 3",
    input: ["6", "6 4 8 3 5 7"].join("\n"),
    output: "21",
    explanation:
      "Rooms 1, 3, and 6 grant 6 + 8 + 7 = 21 without breaking the adjacency rule.",
  },
];

const DP_MUSEUM_GUARD_TESTS = [
  {
    input: DP_MUSEUM_GUARD_EXAMPLES[0].input,
    output: DP_MUSEUM_GUARD_EXAMPLES[0].output,
    explanation: DP_MUSEUM_GUARD_EXAMPLES[0].explanation,
  },
  {
    input: DP_MUSEUM_GUARD_EXAMPLES[1].input,
    output: DP_MUSEUM_GUARD_EXAMPLES[1].output,
    explanation: DP_MUSEUM_GUARD_EXAMPLES[1].explanation,
  },
  {
    input: DP_MUSEUM_GUARD_EXAMPLES[2].input,
    output: DP_MUSEUM_GUARD_EXAMPLES[2].output,
    explanation: DP_MUSEUM_GUARD_EXAMPLES[2].explanation,
  },
  { input: ["1", "9"].join("\n"), output: "9" },
  { input: ["2", "8 5"].join("\n"), output: "8" },
  { input: ["3", "3 9 4"].join("\n"), output: "9" },
  { input: ["5", "2 7 9 3 1"].join("\n"), output: "12" },
  { input: ["5", "10 10 10 10 10"].join("\n"), output: "30" },
  { input: ["8", "1 2 3 4 5 6 7 8"].join("\n"), output: "20" },
  { input: ["7", "100 1 1 100 1 1 100"].join("\n"), output: "300" },
  { input: ["4", "0 0 0 0"].join("\n"), output: "0" },
];

const DP_PROBLEMS: CodeProblem[] = [
  {
    slug: "stair-sprint",
    title: "Stair Sprint",
    difficulty: "intro",
    topics: ["Dynamic Programming", "Counting"],
    description: [
      "You stand at the bottom of a staircase with n steps and a set of allowed jump sizes.",
      "",
      "Count how many distinct ordered jump sequences land you exactly on the top step.",
    ].join("\n"),
    inputFormat: [
      "- Line 1: integers n and k (0 ≤ n ≤ 50, 1 ≤ k ≤ 5) — stair height and number of jump sizes.",
      "- Line 2: k distinct positive integers giving the allowed jump sizes in any order.",
    ].join("\n"),
    constraints: ["0 ≤ n ≤ 50", "1 ≤ k ≤ 5", "1 ≤ jump ≤ 10"],
    examples: DP_STAIR_SPRINT_EXAMPLES,
    tests: DP_STAIR_SPRINT_TESTS,
    hints: [
      "Start with dp[0] = 1: there is one way to stand still before climbing.",
      "For each step i, sum dp[i - jump] for every allowed jump that fits.",
      "If no jump combination lands on n, the DP entry stays 0 and that is the answer.",
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
        "n = int(next(it))",
        "k = int(next(it))",
        "steps = sorted(set(int(next(it)) for _ in range(k)))",
        "dp = [0] * (n + 1)",
        "dp[0] = 1",
        "for i in range(1, n + 1):",
        "    total = 0",
        "    for step in steps:",
        "        if step > i:",
        "            break",
        "        total += dp[i - step]",
        "    dp[i] = total",
        "print(dp[n])",
      ].join("\n"),
    },
    metadataVersion: 2,
  },
  {
    slug: "museum-guard",
    title: "Museum Guard",
    difficulty: "easy",
    topics: ["Dynamic Programming", "Optimisation"],
    description: [
      "You patrol a hallway of n display rooms. Each room has a value representing how exciting it is to guard.",
      "",
      "Pick a subset of rooms to maximise total value, but you cannot guard two adjacent rooms the same night.",
    ].join("\n"),
    inputFormat: [
      "- Line 1: integer n (1 ≤ n ≤ 200_000) — number of rooms.",
      "- Line 2: n integers value_i (−10^6 ≤ value_i ≤ 10^6) for each room.",
    ].join("\n"),
    constraints: ["1 ≤ n ≤ 200_000", "−1_000_000 ≤ value ≤ 1_000_000"],
    examples: DP_MUSEUM_GUARD_EXAMPLES,
    tests: DP_MUSEUM_GUARD_TESTS,
    hints: [
      "Let dp[i] store the best value considering rooms up to i.",
      "Compare skipping room i (dp[i-1]) with taking it (value[i] + dp[i-2]).",
      "Track only the last two DP values to keep memory usage constant.",
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
        "n = int(next(it))",
        "values = [int(next(it)) for _ in range(n)]",
        "prev2 = 0",
        "prev1 = 0",
        "for value in values:",
        "    prev2, prev1 = prev1, max(prev1, prev2 + value)",
        "print(prev1)",
      ].join("\n"),
    },
    metadataVersion: 2,
  },
];

const FLT_QUIZZES: QuizDefinition[] = [
  {
    id: "flt-primer-quiz",
    title: "Prime Power Primer",
    topic: "Fermat's Little Theorem",
    estimatedMinutes: 7,
    progressKey: "primer",
    description:
      "Use stories and quick checks to see why primes make modular arithmetic behave in tight cycles.",
    questions: [
      {
        kind: "info-card",
        id: "flt-primer-card-1",
        prompt: "Prime-Locked Gate",
        eyebrow: "Story",
        body: [
          "**Prime-locked** vaults only respond to residues 0…p-1 when p stays prime.",
          "",
          "- Every spin is just `value mod p`.",
          "- Giant inputs collapse to the tiny remainder the lock understands.",
          "",
          "_Keep that cycle in mind before we reveal Fermat's shortcut._",
        ].join("\n"),
        continueLabel: "Next idea",
      },
      {
        kind: "info-card",
        id: "flt-primer-card-2",
        prompt: "Prime Mod Cycles",
        eyebrow: "Pattern",
        body: [
          "When `p` is prime, multiplying residues `1…p-1` just **reshuffles** the set.",
          "",
          "- No residue vanishes; products stay inside `{1, …, p-1}`.",
          "- The balance shatters the moment you let `p` be composite.",
        ].join("\n"),
        continueLabel: "Makes sense",
      },
      {
        kind: "info-card",
        id: "flt-primer-card-3",
        prompt: "Fermat's Shortcut",
        eyebrow: "Theorem",
        body: [
          "Fermat's little theorem: `a^(p-1) ≡ 1 (mod p)` whenever `gcd(a, p) = 1`.",
          "",
          "- Slash huge exponents modulo `p` by cycling every `p-1` steps.",
          "- Multiply both sides by `a^{-1}` to summon modular inverses.",
        ].join("\n"),
        continueLabel: "Ready to test",
      },
      {
        kind: "multiple-choice",
        id: "flt-primer-naive",
        prompt:
          'Why is "_multiply `a` by itself `b` times_" a terrible plan when computing `a^b mod p` for huge `b`?',
        hint: "Think about how big the intermediate numbers become without taking `mod`.",
        explanation:
          "Intermediate products explode far beyond native limits; applying `mod p` every step keeps numbers tame.",
        options: [
          {
            id: "A",
            label: "A",
            text: "The numbers explode and overflow before you apply `mod p` each time",
          },
          {
            id: "B",
            label: "B",
            text: "It always gives the wrong answer even for tiny inputs",
          },
          {
            id: "C",
            label: "C",
            text: "It only works when `b` is a power of two",
          },
          {
            id: "D",
            label: "D",
            text: "It requires the modulus to be composite",
          },
        ],
        correctOptionId: "A",
        correctFeedback: {
          heading: "Exactly",
          message:
            "Binary exponentiation keeps numbers small by squaring and reducing `mod p` at every step.",
        },
      },
      {
        kind: "multiple-choice",
        id: "flt-primer-value",
        prompt: "If `p` is prime and `gcd(a, p) = 1`, what is `a^(p-1) mod p`?",
        hint: "This is the headline of Fermat's little theorem.",
        explanation: "Fermat's little theorem states `a^(p-1) ≡ 1 (mod p)`.",
        options: [
          { id: "A", label: "A", text: "`0`" },
          { id: "B", label: "B", text: "`1`" },
          { id: "C", label: "C", text: "`p`" },
          { id: "D", label: "D", text: "`a`" },
        ],
        correctOptionId: "B",
        correctFeedback: {
          heading: "Right on",
          message:
            "Every non-zero residue raised to the `(p - 1)`th power loops back to `1 (mod p)`.",
        },
      },
      {
        kind: "type-answer",
        id: "flt-primer-blank",
        prompt: [
          "Complete the sentence: Fermat's little theorem says",
          "",
          "`a^(p-1) ≡ ___ (mod p)`",
          "",
          "whenever",
          "",
          "`gcd(a, p) = 1`.",
        ].join("\n"),
        hint: "_It's a single digit._",
        explanation:
          "The blank is `1`, showing the cycle resets after `p - 1` steps.",
        answer: "1",
        acceptableAnswers: ["one"],
        correctFeedback: {
          heading: "Correct",
          message: "That `1` unlocks modular inverses and exponent reductions.",
        },
      },
      {
        kind: "multiple-choice",
        id: "flt-primer-fail",
        prompt:
          "Which situation breaks Fermat's little theorem so the shortcut no longer holds?",
        hint: "Check the assumptions about `p` and `a`.",
        explanation:
          "If `gcd(a, p) ≠ 1` (for example `a` is a multiple of `p`) the theorem does not apply.",
        options: [
          {
            id: "A",
            label: "A",
            text: "`p` is prime and `gcd(a, p) = 1`",
          },
          {
            id: "B",
            label: "B",
            text: "`p = 35` and `a = 2`",
          },
          {
            id: "C",
            label: "C",
            text: "`p` is prime but `a` is a multiple of `p`",
          },
          {
            id: "D",
            label: "D",
            text: "`p` is prime and `a = 1`",
          },
        ],
        correctOptionId: "C",
        correctFeedback: {
          heading: "Good catch",
          message:
            "We need `gcd(a, p) = 1`. When `a` is divisible by `p`, the conclusion collapses.",
        },
      },
      {
        kind: "type-answer",
        id: "flt-primer-binary",
        prompt:
          "Name the fast algorithm that squares the base and halves the exponent to compute powers quickly.",
        hint: "_Two words_: starts with `binary`.",
        explanation:
          "`Binary exponentiation` (a.k.a. exponentiation by squaring) computes large powers in **O(log b)** steps.",
        answer: "binary exponentiation",
        acceptableAnswers: [
          "Binary exponentiation",
          "exponentiation by squaring",
          "fast exponentiation",
        ],
        correctFeedback: {
          heading: "Speed unlocked",
          message:
            "Binary exponentiation is the workhorse behind the power routine in these problems.",
        },
      },
      {
        kind: "info-card",
        id: "flt-primer-summary",
        prompt: "Shortcut secured",
        eyebrow: "Recap",
        body: [
          "**Remember**: when `gcd(a, p) = 1`, `a^(p-1) ≡ 1 (mod p)`.",
          "",
          "- Reduce wild exponents by stripping multiples of `p-1`.",
          "- Reach for `a^(p-2)` to pull modular inverses instantly.",
          "",
          "_These habits keep number theory fast and steady._",
        ].join("\n"),
        continueLabel: "Onward",
      },
    ],
  },
  {
    id: "flt-wrap-quiz",
    title: "Fermat Wrap-up",
    topic: "Fermat's Little Theorem",
    estimatedMinutes: 5,
    progressKey: "wrap",
    description:
      "Confirm you can pull inverses and huge powers using Fermat's shortcut without slipping on edge cases.",
    questions: [
      {
        kind: "multiple-choice",
        id: "flt-wrap-inverse",
        prompt:
          "Why does `pow(a, p - 2, p)` return the modular inverse of `a` when `p` is prime and `gcd(a, p) = 1`?",
        hint: "Raise `a` to `p - 1` and look at the extra `a` factor.",
        explanation:
          "Because `a^(p-1) ≡ 1 (mod p)`, multiplying both sides by `a^(-1)` shows `a^(p-2)` is the inverse.",
        options: [
          {
            id: "A",
            label: "A",
            text: "Because `pow` always divides by `p` before multiplying",
          },
          {
            id: "B",
            label: "B",
            text: "It follows directly from Fermat's little theorem",
          },
          {
            id: "C",
            label: "C",
            text: "It only works when `a = 1`",
          },
          {
            id: "D",
            label: "D",
            text: "It guesses the answer and retries if wrong",
          },
        ],
        correctOptionId: "B",
        correctFeedback: {
          heading: "Exactly",
          message:
            "Multiplying `a^(p-2)` by `a` gives `a^(p-1) ≡ 1 (mod p)`, so `a^(p-2)` behaves as the inverse.",
        },
      },
      {
        kind: "type-answer",
        id: "flt-wrap-zero",
        prompt:
          "If `a` is divisible by `p`, what value should our modular inverse routine output?",
        hint: "_It signals that no inverse exists._",
        explanation:
          "When `a ≡ 0 (mod p)` there is no multiplicative inverse; returning `-1` keeps the contract clear.",
        answer: "-1",
        acceptableAnswers: ["negative one", "- 1"],
        correctFeedback: {
          heading: "Right call",
          message: "`-1` separates impossible cases from real inverses.",
        },
      },
      {
        kind: "multiple-choice",
        id: "flt-wrap-complexity",
        prompt:
          "Binary exponentiation runs in which time complexity with respect to the exponent `b`?",
        hint: "Count how often you halve `b`.",
        explanation:
          "Each step halves the exponent, so the loop runs **O(log b)** times.",
        options: [
          { id: "A", label: "A", text: "`O(b)`" },
          { id: "B", label: "B", text: "`O(log b)`" },
          { id: "C", label: "C", text: "`O(b log b)`" },
          { id: "D", label: "D", text: "`O(1)`" },
        ],
        correctOptionId: "B",
        correctFeedback: {
          heading: "Yep",
          message:
            "Halving the exponent each iteration gives logarithmic complexity.",
        },
      },
      {
        kind: "multiple-choice",
        id: "flt-wrap-reduce",
        prompt:
          "When is it safe to reduce the exponent `b` using `b % (p - 1)` before powering?",
        hint: "Check the conditions of Fermat's little theorem again: `p` prime and `gcd(a, p) = 1`.",
        explanation:
          "You can reduce the exponent when `gcd(a, p) = 1`; then `a^(p-1) ≡ 1 (mod p)` resets the cycle.",
        options: [
          {
            id: "A",
            label: "A",
            text: "Always, even if p is composite",
          },
          {
            id: "B",
            label: "B",
            text: "Only when `gcd(a, p) = 1` and `p` is prime",
          },
          {
            id: "C",
            label: "C",
            text: "Only when a is even",
          },
          {
            id: "D",
            label: "D",
            text: "Never; that would change the answer",
          },
        ],
        correctOptionId: "B",
        correctFeedback: {
          heading: "Good condition",
          message:
            "Reducing by `(p - 1)` relies on Fermat, so we need `gcd(a, p) = 1` and `p` to be prime.",
        },
      },
      {
        kind: "type-answer",
        id: "flt-wrap-mod",
        prompt:
          "What operation do we apply after each multiplication step to keep numbers bounded by the modulus?",
        hint: "_It's a three-letter word._",
        explanation:
          "Taking the result `mod p` after every multiply keeps values small and correct.",
        answer: "mod",
        acceptableAnswers: ["modulo", "take mod"],
        correctFeedback: {
          heading: "Exactly",
          message:
            "Reduce after every multiply to avoid overflow and stay in range.",
        },
      },
      {
        kind: "info-card",
        id: "flt-wrap-summary",
        prompt: "Number theory boost",
        eyebrow: "Recap",
        body: [
          "**Toolkit recap** before you leave this vault:",
          "",
          "- Use `pow(a, p - 2, p)` whenever `gcd(a, p) = 1`.",
          "- Shrink exponents with `b % (p - 1)` to recycle the cycle.",
          "- Apply `mod` after every multiply to stay bounded.",
          "",
          "_Respect the assumptions and the harder puzzles stay wide open._",
        ].join("\n"),
        continueLabel: "Ready",
      },
    ],
  },
];

const FLT_PRIME_POWER_EXAMPLES = [
  {
    title: "Example 1",
    input: ["17 5 9"].join("\n"),
    output: "12",
    explanation: "pow(5, 9) = 1,953,125; reducing mod 17 leaves 12.",
  },
  {
    title: "Example 2",
    input: ["13 8 100"].join("\n"),
    output: "1",
    explanation:
      "Fermat shrinks the exponent: 8^(12) ≡ 1 mod 13, so 8^100 collapses to 1.",
  },
  {
    title: "Example 3",
    input: ["29 10 1234567890123"].join("\n"),
    output: "19",
    explanation:
      "Binary exponentiation keeps each squaring small; the final remainder is 19.",
  },
];

const FLT_PRIME_POWER_TESTS = [
  {
    input: FLT_PRIME_POWER_EXAMPLES[0].input,
    output: FLT_PRIME_POWER_EXAMPLES[0].output,
    explanation: FLT_PRIME_POWER_EXAMPLES[0].explanation,
  },
  {
    input: FLT_PRIME_POWER_EXAMPLES[1].input,
    output: FLT_PRIME_POWER_EXAMPLES[1].output,
    explanation: FLT_PRIME_POWER_EXAMPLES[1].explanation,
  },
  {
    input: FLT_PRIME_POWER_EXAMPLES[2].input,
    output: FLT_PRIME_POWER_EXAMPLES[2].output,
    explanation: FLT_PRIME_POWER_EXAMPLES[2].explanation,
  },
  { input: ["11 7 0"].join("\n"), output: "1" },
  { input: ["2 1 1000000000000"].join("\n"), output: "1" },
  { input: ["5 0 13"].join("\n"), output: "0" },
  { input: ["101 37 123456789"].join("\n"), output: "31" },
  { input: ["997 996 314159265358"].join("\n"), output: "1" },
  { input: ["97 53 42"].join("\n"), output: "50" },
  { input: ["3 2 27"].join("\n"), output: "2" },
];

const FLT_MODULAR_KEYSMITH_EXAMPLES = [
  {
    title: "Example 1",
    input: ["13 3", "2 5 8"].join("\n"),
    output: "7 8 5",
    explanation: "Inverses: 2^-1 ≡ 7, 5^-1 ≡ 8, 8^-1 ≡ 5 mod 13.",
  },
  {
    title: "Example 2",
    input: ["23 4", "1 11 22 7"].join("\n"),
    output: "1 21 22 10",
    explanation: "22 already equals its inverse because 22*22 ≡ 1 mod 23.",
  },
  {
    title: "Example 3",
    input: ["19 3", "19 38 5"].join("\n"),
    output: "-1 -1 4",
    explanation:
      "Numbers divisible by 19 have no inverse, while 5^-1 ≡ 4 mod 19.",
  },
];

const FLT_MODULAR_KEYSMITH_TESTS = [
  {
    input: FLT_MODULAR_KEYSMITH_EXAMPLES[0].input,
    output: FLT_MODULAR_KEYSMITH_EXAMPLES[0].output,
    explanation: FLT_MODULAR_KEYSMITH_EXAMPLES[0].explanation,
  },
  {
    input: FLT_MODULAR_KEYSMITH_EXAMPLES[1].input,
    output: FLT_MODULAR_KEYSMITH_EXAMPLES[1].output,
    explanation: FLT_MODULAR_KEYSMITH_EXAMPLES[1].explanation,
  },
  {
    input: FLT_MODULAR_KEYSMITH_EXAMPLES[2].input,
    output: FLT_MODULAR_KEYSMITH_EXAMPLES[2].output,
    explanation: FLT_MODULAR_KEYSMITH_EXAMPLES[2].explanation,
  },
  { input: ["17 4", "4 6 15 16"].join("\n"), output: "13 3 8 16" },
  { input: ["29 5", "3 10 21 28 29"].join("\n"), output: "10 3 18 28 -1" },
  { input: ["101 4", "1 50 75 100"].join("\n"), output: "1 99 66 100" },
  { input: ["43 5", "7 14 21 28 35"].join("\n"), output: "37 40 41 20 16" },
  {
    input: ["97 6", "12 24 36 48 60 72"].join("\n"),
    output: "89 93 62 95 76 31",
  },
  { input: ["11 5", "0 1 2 3 4"].join("\n"), output: "-1 1 6 4 3" },
  { input: ["13 1", "1"].join("\n"), output: "1" },
];

const FLT_PROBLEMS: CodeProblem[] = [
  {
    slug: "prime-power-pulse",
    title: "Prime Power Pulse",
    difficulty: "intro",
    topics: ["Fermat's Little Theorem", "Modular Exponentiation"],
    description: [
      "Compute a^b mod p without getting buried under gigantic intermediate numbers.",
      "",
      "Use fast exponentiation and Fermat's little theorem to keep everything lightweight.",
    ].join("\n"),
    inputFormat: [
      "- Line 1: integers p, a, b with p prime (2 ≤ p ≤ 1_000_000_007), 0 ≤ a < p, 0 ≤ b ≤ 10^18.",
    ].join("\n"),
    constraints: ["2 ≤ p ≤ 1_000_000_007", "0 ≤ a < p", "0 ≤ b ≤ 10^18"],
    examples: FLT_PRIME_POWER_EXAMPLES,
    tests: FLT_PRIME_POWER_TESTS,
    hints: [
      "Apply binary exponentiation: square the base, halve the exponent, and reduce mod p after each multiplication.",
      "When b = 0 the answer is 1, matching the empty product.",
      "Fermat lets you optionally reduce b by (p - 1) when gcd(a, p) = 1.",
    ],
    solution: {
      language: "python",
      code: [
        "import sys",
        "",
        "data = sys.stdin.read().strip().split()",
        "if not data:",
        "    sys.exit(0)",
        "p = int(data[0])",
        "a = int(data[1]) % p",
        "b = int(data[2])",
        "result = 1",
        "base = a",
        "exponent = b",
        "while exponent > 0:",
        "    if exponent & 1:",
        "        result = (result * base) % p",
        "    base = (base * base) % p",
        "    exponent //= 2",
        "print(result if b != 0 or a != 0 else 1)",
      ].join("\n"),
    },
    metadataVersion: 2,
  },
  {
    slug: "modular-keysmith",
    title: "Modular Keysmith",
    difficulty: "easy",
    topics: ["Fermat's Little Theorem", "Modular Inverse"],
    description: [
      "Forge modular inverses for several numbers under the same prime modulus.",
      "",
      "Return -1 whenever a number shares a factor with the modulus.",
    ].join("\n"),
    inputFormat: [
      "- Line 1: integers p and q — prime modulus and number of keys (2 ≤ p ≤ 1_000_000_007, 1 ≤ q ≤ 100_000).",
      "- Line 2: q integers a_i (0 ≤ a_i < 10^18).",
    ].join("\n"),
    constraints: [
      "2 ≤ p ≤ 1_000_000_007",
      "1 ≤ q ≤ 100_000",
      "0 ≤ a_i < 10^18",
    ],
    examples: FLT_MODULAR_KEYSMITH_EXAMPLES,
    tests: FLT_MODULAR_KEYSMITH_TESTS,
    hints: [
      "Check each value: if a_i % p == 0, the answer is -1.",
      "Otherwise compute pow(a_i, p - 2, p) using Python's fast modular exponentiation.",
      "Output the inverses on one line separated by spaces.",
    ],
    solution: {
      language: "python",
      code: [
        "import sys",
        "",
        "tokens = sys.stdin.read().strip().split()",
        "if not tokens:",
        "    sys.exit(0)",
        "it = iter(tokens)",
        "p = int(next(it))",
        "q = int(next(it))",
        "values = [int(next(it)) for _ in range(q)]",
        "parts = []",
        "for value in values:",
        "    if value % p == 0:",
        "        parts.append('-1')",
        "    else:",
        "        parts.append(str(pow(value % p, p - 2, p)))",
        "print(' '.join(parts))",
      ].join("\n"),
    },
    metadataVersion: 2,
  },
];

const BFS_SESSION_ID = "welcome-bfs-explorer";
const BFS_STORY_PLAN_ITEM_ID = "welcome-bfs-story";

function buildBfsPlan(storyTitle: string): PlanItem[] {
  return [
    {
      id: BFS_STORY_PLAN_ITEM_ID,
      kind: "media",
      title: storyTitle,
      icon: "📖",
      meta: "Story",
      summary:
        "Follow a layered rescue that introduces breadth-first search from the ground up.",
    },
    {
      id: "bfs-primer-quiz",
      kind: "quiz",
      title: "Level Quest Primer",
      icon: "🧭",
      meta: "10 steps",
      summary:
        "Learn the breadth-first search rhythm and try tiny checks before you code.",
    },
    {
      id: "park-steps",
      kind: "problem",
      title: "Practice · Park Steps",
      icon: "🌲",
      meta: "Graphs · Easy",
      summary: "Use BFS to count the shortest hop count between park spots.",
    },
    {
      id: "maze-scout",
      kind: "problem",
      title: "Challenge · Maze Scout",
      icon: "🧩",
      meta: "Grids · Easy",
      summary:
        "Guide a scout through a grid maze by exploring layers in order.",
    },
    {
      id: "bfs-wrapup-quiz",
      kind: "quiz",
      title: "Level Quest Wrap-up",
      icon: "🏁",
      meta: "7 checks",
      summary:
        "Lock in queue habits, wall handling, and distance tracking before moving on.",
    },
  ];
}

const DP_SESSION_ID = "welcome-dp-blueprint";
const DP_STORY_PLAN_ITEM_ID = "welcome-dp-story";

function buildDpPlan(storyTitle: string): PlanItem[] {
  return [
    {
      id: DP_STORY_PLAN_ITEM_ID,
      kind: "media",
      title: storyTitle,
      icon: "📖",
      meta: "Story",
      summary:
        "Hear how reuse and base cases turn a tough quest into a solvable blueprint.",
    },
    {
      id: "dp-primer-quiz",
      kind: "quiz",
      title: "Blueprint Warm-up",
      icon: "🧠",
      meta: "9 steps",
      summary:
        "Turn overlapping puzzles into states, transitions, and steady base cases.",
    },
    {
      id: "stair-sprint",
      kind: "problem",
      title: "Practice · Stair Sprint",
      icon: "🪜",
      meta: "Counting · Intro",
      summary:
        "Count staircase paths with a DP table that grows from the ground up.",
    },
    {
      id: "museum-guard",
      kind: "problem",
      title: "Challenge · Museum Guard",
      icon: "🛡️",
      meta: "Optimisation · Easy",
      summary:
        "Maximise guard value while respecting the no-adjacent constraint.",
    },
    {
      id: "dp-wrap-quiz",
      kind: "quiz",
      title: "Blueprint Wrap-up",
      icon: "✅",
      meta: "6 checks",
      summary:
        "Explain your DP states, transitions, and memory trims to lock in the habit.",
    },
  ];
}

const FLT_SESSION_ID = "welcome-fermats-flash";
const FLT_STORY_PLAN_ITEM_ID = "welcome-fermats-story";

function buildFermatPlan(storyTitle: string): PlanItem[] {
  return [
    {
      id: FLT_STORY_PLAN_ITEM_ID,
      kind: "media",
      title: storyTitle,
      icon: "📖",
      meta: "Story",
      summary:
        "Step into a prime-coded vault and discover why residues cycle so neatly.",
    },
    {
      id: "flt-primer-quiz",
      kind: "quiz",
      title: "Prime Power Primer",
      icon: "🔍",
      meta: "9 steps",
      summary:
        "See how Fermat's shortcut turns primes into instant power tricks.",
    },
    {
      id: "prime-power-pulse",
      kind: "problem",
      title: "Practice · Prime Power Pulse",
      icon: "⚡",
      meta: "Exponent · Intro",
      summary: "Practice fast modular exponentiation with binary squaring.",
    },
    {
      id: "modular-keysmith",
      kind: "problem",
      title: "Challenge · Modular Keysmith",
      icon: "🔑",
      meta: "Inverses · Easy",
      summary: "Forge modular inverses quickly and flag the numbers with none.",
    },
    {
      id: "flt-wrap-quiz",
      kind: "quiz",
      title: "Fermat Wrap-up",
      icon: "✅",
      meta: "6 checks",
      summary:
        "Confirm you can wield Fermat's shortcut and its edge cases with confidence.",
    },
  ];
}

const BFS_BLUEPRINT: WelcomeSessionBlueprint = {
  sessionId: BFS_SESSION_ID,
  key: BFS_SESSION_ID,
  title: "Layer Quest: Breadth-first Search",
  tagline: "Explore graphs level by level until the shortest route appears.",
  emoji: "🧭",
  topic: "Breadth-first Search",
  storyPlanItemId: BFS_STORY_PLAN_ITEM_ID,
  buildPlan: buildBfsPlan,
  quizzes: BFS_QUIZZES,
  problems: BFS_PROBLEMS,
};

const DP_BLUEPRINT: WelcomeSessionBlueprint = {
  sessionId: DP_SESSION_ID,
  key: DP_SESSION_ID,
  title: "Dynamic Programming Blueprint",
  tagline: "Reuse solved steps to climb tougher puzzles with confidence.",
  emoji: "🧠",
  topic: "Dynamic Programming",
  storyPlanItemId: DP_STORY_PLAN_ITEM_ID,
  buildPlan: buildDpPlan,
  quizzes: DP_QUIZZES,
  problems: DP_PROBLEMS,
};

const FLT_BLUEPRINT: WelcomeSessionBlueprint = {
  sessionId: FLT_SESSION_ID,
  key: FLT_SESSION_ID,
  title: "Prime Sparks: Fermat's Shortcut",
  tagline: "Turn prime moduli into instant powers and modular keys.",
  emoji: "🔑",
  topic: "Fermat's Little Theorem",
  storyPlanItemId: FLT_STORY_PLAN_ITEM_ID,
  buildPlan: buildFermatPlan,
  quizzes: FLT_QUIZZES,
  problems: FLT_PROBLEMS,
};

const WELCOME_BLUEPRINTS: WelcomeSessionBlueprint[] = [
  BFS_BLUEPRINT,
  DP_BLUEPRINT,
  FLT_BLUEPRINT,
];

const StageEnum = z.enum(["validate", "story", "seed", "publish"]);
type StageName = z.infer<typeof StageEnum>;
const STAGE_ORDER: StageName[] = StageEnum.options;

const optionsSchema = z.object({
  stages: z.array(StageEnum).default([]),
  pyodideIndexUrl: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, "pyodide index url cannot be empty")
    .optional(),
  sessions: z
    .array(z.string().trim().min(1))
    .default([])
    .transform((items) => Array.from(new Set(items))),
});

type CliOptions = z.infer<typeof optionsSchema>;

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

  try {
    const serviceAccount = getGoogleServiceAccount();
    return `${serviceAccount.projectId}.firebasestorage.app`;
  } catch (error) {
    throw new Error(
      "FIREBASE_STORAGE_BUCKET (or STORAGE_BUCKET) must be provided to publish media assets.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

function resolveDebugRootBaseDir(): string {
  return path.join(
    WORKSPACE_PATHS.codeSyntheticDir,
    "sessions",
    TEMPLATE_USER_ID,
  );
}

function resolveSessionRootDir(baseDir: string, sessionId: string): string {
  return path.join(baseDir, sessionId);
}

function resolveSessionDebugRootDir(
  baseDir: string,
  sessionId: string,
): string {
  return resolveSessionRootDir(baseDir, sessionId);
}

function resolveStoryCheckpointsRootDir(sessionId: string): string {
  const sessionRootDir = resolveSessionRootDir(
    resolveDebugRootBaseDir(),
    sessionId,
  );
  return path.join(sessionRootDir, "checkpoints");
}

function resolveStoryCheckpointDir(
  sessionId: string,
  _planItemId: string,
): string {
  return resolveStoryCheckpointsRootDir(sessionId);
}

function resolvePlanItemStoryCheckpointDir(
  sessionId: string,
  planItemId: string,
): string {
  return path.join(resolveStoryCheckpointsRootDir(sessionId), planItemId);
}

function resolveLegacyStoryCheckpointDir(
  sessionId: string,
  planItemId: string,
): string {
  return path.join(
    resolveDebugRootBaseDir(),
    "checkpoints",
    sessionId,
    planItemId,
  );
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

async function ensureStoryCheckpointDir(
  sessionId: string,
  planItemId: string,
): Promise<string> {
  const targetDir = resolveStoryCheckpointDir(sessionId, planItemId);
  const nestedPlanItemDir = resolvePlanItemStoryCheckpointDir(
    sessionId,
    planItemId,
  );
  const legacyDir = resolveLegacyStoryCheckpointDir(sessionId, planItemId);

  const migrateDirContents = async (
    sourceDir: string,
    sourceLabel: string,
  ): Promise<boolean> => {
    if (!(await pathExists(sourceDir))) {
      return false;
    }
    await mkdir(targetDir, { recursive: true });
    const entries = await readdir(sourceDir);
    for (const entry of entries) {
      const fromPath = path.join(sourceDir, entry);
      const toPath = path.join(targetDir, entry);
      if (await pathExists(toPath)) {
        console.warn(
          `[welcome/${sessionId}] checkpoint ${entry} already exists in ${targetDir}; leaving ${fromPath} untouched`,
        );
        continue;
      }
      await rename(fromPath, toPath);
    }
    await rm(sourceDir, { recursive: true, force: true });
    console.log(
      `[welcome/${sessionId}] migrated checkpoints from ${sourceLabel} to ${targetDir}`,
    );
    return true;
  };

  await migrateDirContents(nestedPlanItemDir, nestedPlanItemDir);
  await migrateDirContents(legacyDir, legacyDir);
  await mkdir(targetDir, { recursive: true });
  return targetDir;
}

function resolveStageSequence(options: CliOptions): StageName[] {
  if (options.stages.length === 0) {
    return STAGE_ORDER;
  }
  const requested = new Set<StageName>(options.stages);
  return STAGE_ORDER.filter((stage) => requested.has(stage));
}

function selectBlueprints(
  blueprints: readonly WelcomeSessionBlueprint[],
  requested: readonly string[],
): WelcomeSessionBlueprint[] {
  if (requested.length === 0) {
    return [...blueprints];
  }
  const allowed = new Set(requested);
  return blueprints.filter((blueprint) => allowed.has(blueprint.sessionId));
}

function getTemplateDocRef(sessionId: string) {
  const firestore = getFirebaseAdminFirestore();
  return firestore
    .collection(TEMPLATE_ROOT_COLLECTION)
    .doc(TEMPLATE_ROOT_DOC)
    .collection(TEMPLATE_SESSIONS_COLLECTION)
    .doc(sessionId);
}

async function seedSessionState(
  userId: string,
  session: Session,
): Promise<void> {
  const firestore = getFirebaseAdminFirestore();
  const stateRef = firestore
    .collection("spark")
    .doc(userId)
    .collection("state")
    .doc(session.id);

  const baseState: SessionState = SessionStateSchema.parse({
    sessionId: session.id,
    items: session.plan.reduce<Record<string, SessionState["items"][string]>>(
      (acc, item) => {
        acc[item.id] = { status: "not_started" };
        return acc;
      },
      {},
    ),
    lastUpdatedAt: Timestamp.now(),
  });

  await stateRef.set(baseState);
}

async function copyMediaDocToTemplate(
  sessionId: string,
  planItemId: string,
): Promise<void> {
  const firestore = getFirebaseAdminFirestore();
  const sourceDoc = firestore
    .collection("spark")
    .doc(TEMPLATE_USER_ID)
    .collection("sessions")
    .doc(sessionId)
    .collection("media")
    .doc(planItemId);

  const snapshot = await sourceDoc.get();
  if (!snapshot.exists) {
    console.warn(
      `[welcome/${sessionId}] media doc ${planItemId} not found under template user; story stage likely missing`,
    );
    return;
  }

  const targetDoc = getTemplateDocRef(sessionId)
    .collection("media")
    .doc(planItemId);

  const data = snapshot.data();
  if (!data) {
    console.warn(
      `[welcome/${sessionId}] media doc ${planItemId} is empty under template user; skipping copy`,
    );
    return;
  }

  await targetDoc.set(data);
}

async function ensureStoryResult(
  context: WelcomeSessionContext,
  blueprint: WelcomeSessionBlueprint,
  runtime: RuntimeConfig,
): Promise<GenerateStoryResult> {
  if (context.storyResult) {
    return context.storyResult;
  }

  const checkpointDir = await ensureStoryCheckpointDir(
    blueprint.sessionId,
    blueprint.storyPlanItemId,
  );

  const [storyResult] = await runJobsWithConcurrency({
    items: [blueprint.sessionId],
    concurrency: 1,
    getId: () => blueprint.sessionId,
    label: `[welcome/${blueprint.sessionId}/story]`,
    handler: async (_item, { progress }) => {
      return generateStory({
        topic: blueprint.topic,
        userId: runtime.userId,
        sessionId: blueprint.sessionId,
        planItemId: blueprint.storyPlanItemId,
        storageBucket: runtime.storageBucket,
        progress,
        debugRootDir: resolveSessionDebugRootDir(
          runtime.debugRootBaseDir,
          blueprint.sessionId,
        ),
        checkpointDir,
      });
    },
  });

  context.storyResult = storyResult;
  return storyResult;
}

async function runStoryStage(
  context: WelcomeSessionContext,
  blueprint: WelcomeSessionBlueprint,
  runtime: RuntimeConfig,
): Promise<void> {
  await ensureStoryResult(context, blueprint, runtime);
}

async function runValidateStage(
  contexts: Map<string, WelcomeSessionContext>,
  blueprints: readonly WelcomeSessionBlueprint[],
  options: CliOptions,
): Promise<void> {
  const problems = blueprints.flatMap((blueprint) => {
    const context = contexts.get(blueprint.sessionId) ?? {};
    contexts.set(blueprint.sessionId, context);
    const parsedProblems = blueprint.problems.map((problem) =>
      CodeProblemSchema.parse(problem),
    );
    context.problems = parsedProblems;
    return parsedProblems;
  });

  await validateProblems(problems, {
    logger: (message) => {
      console.log(message);
    },
    indexURL: options.pyodideIndexUrl,
  });
}

type SessionSeedData = {
  session: Session;
  sessionData: z.input<typeof SessionSchema> & {
    tagline: string;
    emoji: string;
    topic: string;
    key: string;
  };
};

function buildSessionData(
  blueprint: WelcomeSessionBlueprint,
  storyTitle: string,
): SessionSeedData {
  const plan = blueprint.buildPlan(storyTitle);
  const sessionData = {
    id: blueprint.sessionId,
    title: blueprint.title,
    createdAt: Timestamp.now(),
    plan,
    tagline: blueprint.tagline,
    emoji: blueprint.emoji,
    topic: blueprint.topic,
    key: blueprint.key,
  } satisfies z.input<typeof SessionSchema> & {
    tagline: string;
    emoji: string;
    topic: string;
    key: string;
  };

  const session = SessionSchema.parse(sessionData);
  return { session, sessionData: { ...sessionData, title: session.title } };
}

async function seedTemplateContent(
  blueprint: WelcomeSessionBlueprint,
  seedData: SessionSeedData,
): Promise<void> {
  const templateDoc = getTemplateDocRef(blueprint.sessionId);

  await templateDoc.set({
    id: seedData.session.id,
    title: seedData.session.title,
    createdAt: seedData.session.createdAt,
    plan: seedData.session.plan,
    tagline: seedData.sessionData.tagline,
    emoji: seedData.sessionData.emoji,
    topic: seedData.sessionData.topic,
    key: seedData.sessionData.key,
  });

  const quizCollection = templateDoc.collection("quiz");
  const quizDocs = await quizCollection.listDocuments();
  const nextQuizIds = new Set(blueprint.quizzes.map((quiz) => quiz.id));
  await Promise.all(
    quizDocs
      .filter((doc) => !nextQuizIds.has(doc.id))
      .map(async (doc) => {
        await doc.delete();
      }),
  );
  await Promise.all(
    blueprint.quizzes.map(async (quiz) => {
      const parsed = QuizDefinitionSchema.parse(quiz);
      await quizCollection.doc(parsed.id).set(parsed);
    }),
  );

  const codeCollection = templateDoc.collection("code");
  const codeDocs = await codeCollection.listDocuments();
  const nextProblemIds = new Set(
    blueprint.problems.map((problem) => problem.slug),
  );
  await Promise.all(
    codeDocs
      .filter((doc) => !nextProblemIds.has(doc.id))
      .map(async (doc) => {
        await doc.delete();
      }),
  );
  await Promise.all(
    blueprint.problems.map(async (problem) => {
      const parsed = CodeProblemSchema.parse(problem);
      await codeCollection.doc(parsed.slug).set(parsed);
    }),
  );
}

async function seedUserPreview(
  blueprint: WelcomeSessionBlueprint,
  seedData: SessionSeedData,
): Promise<void> {
  const userRef = getFirebaseAdminFirestore()
    .collection("spark")
    .doc(TEMPLATE_USER_ID);

  await userRef
    .collection("sessions")
    .doc(seedData.session.id)
    .set(seedData.session);

  await Promise.all(
    blueprint.quizzes.map(async (quiz) => {
      const parsed = QuizDefinitionSchema.parse(quiz);
      await userRef
        .collection("sessions")
        .doc(seedData.session.id)
        .collection("quiz")
        .doc(parsed.id)
        .set(parsed);
    }),
  );

  await Promise.all(
    blueprint.problems.map(async (problem) => {
      const parsed = CodeProblemSchema.parse(problem);
      await userRef
        .collection("sessions")
        .doc(seedData.session.id)
        .collection("code")
        .doc(parsed.slug)
        .set(parsed);
    }),
  );

  await seedSessionState(TEMPLATE_USER_ID, seedData.session);
}

async function runSeedStage(
  context: WelcomeSessionContext,
  blueprint: WelcomeSessionBlueprint,
  runtime: RuntimeConfig,
): Promise<void> {
  const storyResult = await ensureStoryResult(context, blueprint, runtime);
  const seedData = buildSessionData(blueprint, storyResult.title);

  await seedTemplateContent(blueprint, seedData);
  await seedUserPreview(blueprint, seedData);
  await copyMediaDocToTemplate(blueprint.sessionId, blueprint.storyPlanItemId);

  context.session = seedData.session;
  context.sessionData = seedData.sessionData;

  console.log(
    `[welcome/${blueprint.sessionId}] Seeded session template and preview data`,
  );
}

async function publishMediaAssets(
  blueprint: WelcomeSessionBlueprint,
  runtime: RuntimeConfig,
): Promise<void> {
  const sources = MEDIA_SOURCES.filter(
    (source) => source.sessionId === blueprint.sessionId,
  );
  if (sources.length === 0) {
    console.log(
      `[welcome/${blueprint.sessionId}] no auxiliary media to publish`,
    );
    return;
  }

  for (const source of sources) {
    await synthesizeAndPublishNarration({
      userId: runtime.userId,
      sessionId: blueprint.sessionId,
      planItemId: source.planItemId,
      segments: source.segments,
      storageBucket: runtime.storageBucket,
      progress: createConsoleProgress(
        `${blueprint.sessionId}/${source.planItemId}`,
      ),
    });
  }
}

async function runPublishStage(
  _context: WelcomeSessionContext,
  blueprint: WelcomeSessionBlueprint,
  runtime: RuntimeConfig,
): Promise<void> {
  await publishMediaAssets(blueprint, runtime);
}

function logCompletedStages(
  completedStages: StageName[],
  sessionIds: readonly string[],
): void {
  console.log(
    `[welcome] Completed stages: ${completedStages.join(", ")} for sessions ${sessionIds.join(", ")}`,
  );
}

async function executeStages(
  blueprints: readonly WelcomeSessionBlueprint[],
  options: CliOptions,
): Promise<void> {
  ensureEvalEnvLoaded();

  const storageBucket = resolveStorageBucket();
  const runtime: RuntimeConfig = {
    userId: TEMPLATE_USER_ID,
    storageBucket,
    debugRootBaseDir: resolveDebugRootBaseDir(),
  };

  const contexts = new Map<string, WelcomeSessionContext>();
  const stageSequence = resolveStageSequence(options);
  if (stageSequence.length === 0) {
    console.log("No stages selected; exiting.");
    return;
  }

  for (const blueprint of blueprints) {
    contexts.set(blueprint.sessionId, contexts.get(blueprint.sessionId) ?? {});
  }

  for (const stage of stageSequence) {
    switch (stage) {
      case "validate":
        await runValidateStage(contexts, blueprints, options);
        break;
      case "story":
        for (const blueprint of blueprints) {
          const context = contexts.get(blueprint.sessionId) ?? {};
          contexts.set(blueprint.sessionId, context);
          await runStoryStage(context, blueprint, runtime);
        }
        break;
      case "seed":
        for (const blueprint of blueprints) {
          const context = contexts.get(blueprint.sessionId) ?? {};
          contexts.set(blueprint.sessionId, context);
          await runSeedStage(context, blueprint, runtime);
        }
        break;
      case "publish":
        for (const blueprint of blueprints) {
          const context = contexts.get(blueprint.sessionId) ?? {};
          contexts.set(blueprint.sessionId, context);
          await runPublishStage(context, blueprint, runtime);
        }
        break;
      default:
        throw new Error(`Unsupported stage '${stage}'`);
    }
  }

  logCompletedStages(
    stageSequence,
    blueprints.map((item) => item.sessionId),
  );
}

function parseOptions(raw: {
  stages?: StageName[];
  pyodideIndexUrl?: string;
  sessions?: string[];
}): CliOptions {
  return optionsSchema.parse({
    stages: raw.stages ?? [],
    pyodideIndexUrl: raw.pyodideIndexUrl,
    sessions: raw.sessions ?? [],
  });
}

function registerCli(): { program: Command; options: CliOptions } {
  const program = new Command();
  const stagesOption = new Option(
    "--stages <stage...>",
    "Run only the selected stages",
  ).choices(StageEnum.options);
  const pyodideOption = new Option(
    "--pyodide-index-url <url>",
    "Override the Pyodide index URL",
  ).env("PYODIDE_INDEX_URL");
  const sessionsOption = new Option(
    "--sessions <sessionId...>",
    "Limit execution to specific session IDs",
  );

  program.addOption(stagesOption);
  program.addOption(pyodideOption);
  program.addOption(sessionsOption);

  program.parse(process.argv);
  const rawOptions = program.opts<{
    stages?: StageName[];
    pyodideIndexUrl?: string;
    sessions?: string[];
  }>();

  const options = parseOptions(rawOptions);
  return { program, options };
}

export async function main(
  blueprints: readonly WelcomeSessionBlueprint[] = WELCOME_BLUEPRINTS,
): Promise<void> {
  const { options } = registerCli();
  const selectedBlueprints = selectBlueprints(blueprints, options.sessions);
  if (selectedBlueprints.length === 0) {
    console.log("No welcome sessions selected; exiting.");
    return;
  }

  await executeStages(selectedBlueprints, options);
}

main().catch((error) => {
  if (error instanceof ProblemValidationError) {
    console.error("Canonical solution validation failed:");
    for (const issue of error.issues) {
      const label =
        issue.testIndex >= 0 ? `test ${issue.testIndex + 1}` : "validation";
      console.error(`- ${issue.slug} (${label}): ${issue.message}`);
    }
  } else {
    console.error("Failed to generate welcome sessions", error);
  }
  process.exit(1);
});
