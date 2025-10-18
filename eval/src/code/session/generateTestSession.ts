import { mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { Command, Option } from "commander";
import { Timestamp, type DocumentReference } from "firebase-admin/firestore";
import { z } from "zod";
import {
  getTestUserId,
  getFirebaseAdminFirestore,
  getGoogleServiceAccount,
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
import type { MediaSegment } from "@spark/llm";

import {
  TEST_SESSION_ID,
  TEST_SESSION_TITLE,
  STORY_PLAN_ITEM_ID,
  STORY_TOPIC,
} from "./constants";
import { ensureEvalEnvLoaded, WORKSPACE_PATHS } from "../../utils/paths";
import {
  createConsoleProgress,
  synthesizeAndPublishNarration,
} from "./narration";
import { generateStory, type GenerateStoryResult } from "./generateStory";
import { validateProblems, ProblemValidationError } from "./problemValidation";
import { runJobsWithConcurrency } from "../../utils/concurrency";
// No local audio file constants: audio is generated on the fly

const MEDIA_SOURCES: Array<{
  planItemId: string;
  segments: MediaSegment[];
}> = [];

const QUIZZES: QuizDefinition[] = [
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
          "Imagine a park filled with rope bridges between treehouses. You start in the Clubhouse and every bridge takes the same time to cross.",
          "",
          "Breadth-first Search explores every treehouse one step away, then every treehouse two steps away. That way the first time you reach the Snack Shack you know it was the shortest hop count.",
        ].join("\\n"),
        continueLabel: "Next idea",
      },
      {
        kind: "info-card",
        id: "bfs-primer-card-2",
        prompt: "Levels Keep Us Oriented",
        eyebrow: "Levels",
        body: [
          "Think of each wave as a level. Level 0 is the starting spot. Level 1 holds every room one step away, level 2 holds rooms two steps away, and so on.",
          "",
          "We finish the current level before touching the next one. This steady rhythm is how we protect the shortest-path promise.",
        ].join("\\n"),
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
          "Whenever we discover new neighbours, we add them to the back of the queue. We take the next place from the front, keeping the levels tidy without extra effort.",
        ].join("\\n"),
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
        ].join("\\n"),
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
        ].join("\\n"),
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
        ].join("\\n"),
        continueLabel: "Ready for more",
      },
    ],
  },
];

const PARK_STEPS_EXAMPLES = [
  {
    title: "Example 1",
    input: ["5 5", "1 2", "1 3", "2 4", "3 4", "4 5", "1 5"].join("\\n"),
    output: "3",
    explanation: "One shortest walk is 1 → 3 → 4 → 5, which uses 3 bridges.",
  },
  {
    title: "Example 2",
    input: ["4 2", "1 2", "3 4", "1 4"].join("\\n"),
    output: "-1",
    explanation:
      "Spot 4 is cut off from spot 1, so there is no route and we print -1.",
  },
  {
    title: "Example 3",
    input: ["3 2", "1 2", "2 3", "2 2"].join("\\n"),
    output: "0",
    explanation:
      "The start and goal are the same spot, so the answer is 0 steps.",
  },
];

const PARK_STEPS_TESTS = [
  {
    input: PARK_STEPS_EXAMPLES[0].input,
    output: PARK_STEPS_EXAMPLES[0].output,
    explanation: PARK_STEPS_EXAMPLES[0].explanation,
  },
  {
    input: PARK_STEPS_EXAMPLES[1].input,
    output: PARK_STEPS_EXAMPLES[1].output,
    explanation: PARK_STEPS_EXAMPLES[1].explanation,
  },
  {
    input: PARK_STEPS_EXAMPLES[2].input,
    output: PARK_STEPS_EXAMPLES[2].output,
    explanation: PARK_STEPS_EXAMPLES[2].explanation,
  },
  {
    input: ["1 0", "1 1"].join("\\n"),
    output: "0",
    explanation: "Only one spot exists, so staying put takes 0 bridges.",
  },
  {
    input: ["2 1", "1 2", "1 2"].join("\\n"),
    output: "1",
    explanation: "A single bridge links spot 1 to spot 2.",
  },
  {
    input: ["5 4", "1 2", "2 3", "3 4", "4 5", "1 5"].join("\\n"),
    output: "4",
    explanation: "The only route is the chain 1 → 2 → 3 → 4 → 5.",
  },
  {
    input: [
      "5 6",
      "1 2",
      "2 3",
      "3 4",
      "4 5",
      "1 3",
      "2 5",
      "1 5",
    ].join("\\n"),
    output: "2",
    explanation: "Breadth-first Search finds the shortcut 1 → 2 → 5.",
  },
  {
    input: ["5 3", "1 2", "2 3", "4 5", "1 5"].join("\\n"),
    output: "-1",
    explanation:
      "Spots 1–3 form a component that never reaches spot 5.",
  },
  {
    input: [
      "6 6",
      "1 2",
      "1 3",
      "2 4",
      "3 5",
      "4 6",
      "5 6",
      "1 6",
    ].join("\\n"),
    output: "3",
    explanation: "Shortest path is 1 → 2 → 4 → 6 (three bridges).",
  },
  {
    input: [
      "7 6",
      "1 2",
      "2 3",
      "3 4",
      "4 5",
      "5 6",
      "6 7",
      "4 4",
    ].join("\\n"),
    output: "0",
    explanation: "Start and goal are the same numbered spot.",
  },
];

const MAZE_SCOUT_EXAMPLES = [
  {
    title: "Example 1",
    input: ["3 3", "S..", ".##", "..T"].join("\\n"),
    output: "4",
    explanation: "One shortest walk is S → (1,0) → (2,0) → (2,1) → T.",
  },
  {
    title: "Example 2",
    input: ["3 3", "S#T", "###", "..."].join("\\n"),
    output: "-1",
    explanation: "Walls block every route to T, so the answer is -1.",
  },
  {
    title: "Example 3",
    input: ["4 5", "S...#", ".#.#.", ".#..T", "....."].join("\\n"),
    output: "6",
    explanation:
      "Breadth-first Search weaves through the open cells and reaches T in 6 steps.",
  },
];

const MAZE_SCOUT_TESTS = [
  {
    input: MAZE_SCOUT_EXAMPLES[0].input,
    output: MAZE_SCOUT_EXAMPLES[0].output,
    explanation: MAZE_SCOUT_EXAMPLES[0].explanation,
  },
  {
    input: MAZE_SCOUT_EXAMPLES[1].input,
    output: MAZE_SCOUT_EXAMPLES[1].output,
    explanation: MAZE_SCOUT_EXAMPLES[1].explanation,
  },
  {
    input: MAZE_SCOUT_EXAMPLES[2].input,
    output: MAZE_SCOUT_EXAMPLES[2].output,
    explanation: MAZE_SCOUT_EXAMPLES[2].explanation,
  },
  {
    input: ["1 2", "ST"].join("\\n"),
    output: "1",
    explanation: "Moving right once reaches the treasure immediately.",
  },
  {
    input: ["2 2", "S#", "#T"].join("\\n"),
    output: "-1",
    explanation: "Walls block every possible move toward T.",
  },
  {
    input: ["3 4", "S..#", ".#..", "..T."].join("\\n"),
    output: "4",
    explanation: "We weave around the walls in four moves.",
  },
  {
    input: ["4 4", "S..#", ".#.#", "...#", "..T."].join("\\n"),
    output: "5",
    explanation: "A narrow corridor guides the scout to T in five steps.",
  },
  {
    input: ["5 5", "S....", "#####", "....#", "#..#.", "..T.."].join("\\n"),
    output: "-1",
    explanation: "The solid wall row traps S away from T.",
  },
  {
    input: ["4 3", "S..", ".#.", ".#.", "..T"].join("\\n"),
    output: "5",
    explanation: "The scout must detour down the left column before turning.",
  },
  {
    input: [
      "5 5",
      "S#...",
      ".#.#.",
      "..#..",
      ".##.#",
      "...T.",
    ].join("\\n"),
    output: "7",
    explanation: "Seven careful moves wind through the maze to reach T.",
  },
];

const PROBLEMS: CodeProblem[] = [
  {
    slug: "park-steps",
    title: "Park Steps",
    difficulty: "easy",
    topics: ["Breadth-first Search", "Graphs"],
    description: [
      "You are planning a mini treasure hunt around the park. There are N numbered meeting spots connected by M two-way paths of equal length.",
      "",
      "Starting at spot s, print the fewest paths needed to reach spot t. If the goal is unreachable, print -1.",
    ].join("\\n"),
    inputFormat: [
      "- Line 1: integers N and M — the number of spots and the number of paths.",
      "- Lines 2..(M+1): each line has two integers u v describing a two-way path between spots u and v.",
      "- Line M+2: integers s and t — the start and goal spots.",
    ].join("\\n"),
    constraints: ["1 ≤ N ≤ 10_000", "0 ≤ M ≤ 20_000", "1 ≤ u, v, s, t ≤ N"],
    examples: PARK_STEPS_EXAMPLES,
    tests: PARK_STEPS_TESTS,
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
      ].join("\\n"),
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
    ].join("\\n"),
    inputFormat: [
      "- Line 1: integers R and C — the number of rows and columns.",
      "- Lines 2..(R+1): each line is a string of length C containing characters '.', '#', 'S', or 'T'.",
    ].join("\\n"),
    constraints: [
      "1 ≤ R, C ≤ 200",
      "Exactly one 'S' and one 'T' appear in the grid.",
    ],
    examples: MAZE_SCOUT_EXAMPLES,
    tests: MAZE_SCOUT_TESTS,
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
      ].join("\\n"),
    },
    metadataVersion: 2,
  },
];

function buildPlan(storyTitle: string): PlanItem[] {
  return [
    {
      id: STORY_PLAN_ITEM_ID,
      kind: "media",
      title: storyTitle,
      icon: "📖",
      meta: "Story",
      summary:
        "Hear a level-by-level adventure that sets up today’s Breadth-first Search practice.",
    },
    {
      id: "bfs-primer-quiz",
      kind: "quiz",
      title: "Level Quest Primer",
      icon: "🧭",
      meta: "10 steps",
      summary:
        "Learn the Breadth-first Search rhythm and try tiny checks before you code.",
    },
    {
      id: "park-steps",
      kind: "problem",
      title: "Practice · Park Steps",
      icon: "🌲",
      meta: "Graphs • Easy",
      summary:
        "Use Breadth-first Search to count the shortest hop count between park spots.",
    },
    {
      id: "maze-scout",
      kind: "problem",
      title: "Challenge · Maze Scout",
      icon: "🧩",
      meta: "Grids • Easy",
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
        "Lock in the queue habits, wall handling, and distance tracking you just practised.",
    },
  ];
}

function resolveDebugRootDir(): string {
  return path.join(WORKSPACE_PATHS.codeSyntheticDir, "sessions", "test-user");
}

function resolveSessionRootDir(
  debugRootDir: string,
  sessionId: string,
): string {
  return path.join(debugRootDir, sessionId);
}

function resolveStoryCheckpointDir(
  sessionRootDir: string,
  planItemId: string,
): string {
  return path.join(sessionRootDir, "checkpoints", planItemId);
}

function resolveLegacyStoryCheckpointDir(
  debugRootDir: string,
  sessionId: string,
  planItemId: string,
): string {
  return path.join(debugRootDir, "checkpoints", sessionId, planItemId);
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
  debugRootDir: string,
  sessionRootDir: string,
  sessionId: string,
  planItemId: string,
): Promise<string> {
  const targetDir = resolveStoryCheckpointDir(sessionRootDir, planItemId);
  if (await pathExists(targetDir)) {
    return targetDir;
  }

  const legacyDir = resolveLegacyStoryCheckpointDir(
    debugRootDir,
    sessionId,
    planItemId,
  );
  if (await pathExists(legacyDir)) {
    await mkdir(path.dirname(targetDir), { recursive: true });
    await rename(legacyDir, targetDir);
    console.log(
      `[test-session/${sessionId}] migrated checkpoints from ${legacyDir} to ${targetDir}`,
    );
  }

  return targetDir;
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

async function publishMediaAssets(
  userId: string,
  sessionId: string,
  storageBucket: string,
): Promise<void> {
  if (MEDIA_SOURCES.length === 0) {
    console.log(
      `[test-session/publish] no additional media sources configured; skipping extra narration uploads`,
    );
    return;
  }

  for (const source of MEDIA_SOURCES) {
    await synthesizeAndPublishNarration({
      userId,
      sessionId,
      planItemId: source.planItemId,
      segments: source.segments,
      storageBucket,
      progress: createConsoleProgress(source.planItemId),
    });
  }
}

async function seedContent(
  userId: string,
  session: Session,
  problems: readonly CodeProblem[],
): Promise<DocumentReference> {
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
    problems.map(async (problem) => {
      const parsed = CodeProblemSchema.parse(problem);
      await sessionRef.collection("code").doc(parsed.slug).set(parsed);
    }),
  );

  return userRef;
}

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
});

type CliOptions = z.infer<typeof optionsSchema>;

type RuntimeConfig = {
  userId: string;
  sessionId: string;
  storageBucket: string;
  debugRootDir: string;
  storyCheckpointDir: string;
};

type StageContext = {
  storyResult?: GenerateStoryResult;
  problems?: CodeProblem[];
  session?: Session;
  sessionData?: z.input<typeof SessionSchema>;
  userRef?: DocumentReference;
};

function resolveStageSequence(options: CliOptions): StageName[] {
  if (options.stages.length === 0) {
    return STAGE_ORDER;
  }
  const requested = new Set<StageName>(options.stages);
  return STAGE_ORDER.filter((stage) => requested.has(stage));
}

async function ensureStoryResult(
  context: StageContext,
  runtime: RuntimeConfig,
): Promise<GenerateStoryResult> {
  if (context.storyResult) {
    return context.storyResult;
  }

  const [storyResult] = await runJobsWithConcurrency({
    items: ["story"],
    concurrency: 1,
    getId: () => "story",
    label: "[test-session/story]",
    handler: async (_item, { progress }) => {
      return generateStory({
        topic: STORY_TOPIC,
        userId: runtime.userId,
        sessionId: runtime.sessionId,
        planItemId: STORY_PLAN_ITEM_ID,
        storageBucket: runtime.storageBucket,
        progress,
        debugRootDir: runtime.debugRootDir,
        checkpointDir: runtime.storyCheckpointDir,
      });
    },
  });

  context.storyResult = storyResult;
  return storyResult;
}

async function ensureProblems(context: StageContext): Promise<CodeProblem[]> {
  if (context.problems) {
    return context.problems;
  }
  const parsedProblems = PROBLEMS.map((problem) =>
    CodeProblemSchema.parse(problem),
  );
  context.problems = parsedProblems;
  await Promise.resolve();
  return parsedProblems;
}

async function runStoryStage(
  context: StageContext,
  runtime: RuntimeConfig,
): Promise<void> {
  await ensureStoryResult(context, runtime);
}

async function runValidateStage(
  context: StageContext,
  _runtime: RuntimeConfig,
  options: CliOptions,
): Promise<void> {
  const problems = await ensureProblems(context);
  await validateProblems(problems, {
    logger: (message) => {
      console.log(message);
    },
    indexURL: options.pyodideIndexUrl,
  });
}

async function runSeedStage(
  context: StageContext,
  runtime: RuntimeConfig,
): Promise<void> {
  const storyResult = await ensureStoryResult(context, runtime);
  const problems = await ensureProblems(context);

  const sessionData = {
    id: runtime.sessionId,
    title: TEST_SESSION_TITLE,
    createdAt: Timestamp.now(),
    plan: buildPlan(storyResult.title),
  } satisfies z.input<typeof SessionSchema>;

  const session = SessionSchema.parse(sessionData);

  const userRef = await seedContent(runtime.userId, session, problems);

  await userRef.collection("sessions").doc(session.id).set(sessionData);
  await userRef.set({ currentSessionId: session.id }, { merge: true });

  context.session = session;
  context.sessionData = sessionData;
  context.userRef = userRef;

  console.log(
    `[test-session] Seeded session '${session.id}' for user '${runtime.userId}'`,
  );
}

async function runPublishStage(
  context: StageContext,
  runtime: RuntimeConfig,
): Promise<void> {
  if (!context.session) {
    throw new Error(
      "Cannot publish media assets before seeding the session. Run the 'seed' stage first.",
    );
  }

  await publishMediaAssets(
    runtime.userId,
    context.session.id,
    runtime.storageBucket,
  );

  console.log(
    `[test-session] Published media assets for session '${context.session.id}'`,
  );
}

async function main(): Promise<void> {
  ensureEvalEnvLoaded();

  const program = new Command();
  const stagesOption = new Option(
    "--stages <stage...>",
    "Run only the selected stages",
  ).choices(StageEnum.options);
  const pyodideOption = new Option(
    "--pyodide-index-url <url>",
    "Override the Pyodide index URL",
  ).env("PYODIDE_INDEX_URL");

  program.addOption(stagesOption);
  program.addOption(pyodideOption);
  program.parse(process.argv);

  const rawOptions = program.opts<{
    stages?: StageName[];
    pyodideIndexUrl?: string;
  }>();

  const options = optionsSchema.parse({
    stages: rawOptions.stages ?? [],
    pyodideIndexUrl: rawOptions.pyodideIndexUrl,
  });

  const stageSequence = resolveStageSequence(options);
  if (stageSequence.length === 0) {
    console.log("No stages selected; exiting.");
    return;
  }

  const userId = getTestUserId();
  const sessionId = TEST_SESSION_ID;
  const storageBucket = resolveStorageBucket();
  const debugRootBaseDir = resolveDebugRootDir();
  const sessionRootDir = resolveSessionRootDir(debugRootBaseDir, sessionId);
  const storyCheckpointDir = await ensureStoryCheckpointDir(
    debugRootBaseDir,
    sessionRootDir,
    sessionId,
    STORY_PLAN_ITEM_ID,
  );

  const runtime: RuntimeConfig = {
    userId,
    sessionId,
    storageBucket,
    debugRootDir: sessionRootDir,
    storyCheckpointDir,
  };

  const context: StageContext = {};

  for (const stage of stageSequence) {
    switch (stage) {
      case "validate":
        await runValidateStage(context, runtime, options);
        break;
      case "story":
        await runStoryStage(context, runtime);
        break;
      case "seed":
        await runSeedStage(context, runtime);
        break;
      case "publish":
        await runPublishStage(context, runtime);
        break;
      default:
        throw new Error(`Unsupported stage '${stage}'`);
    }
  }

  console.log(
    `[test-session] Completed stages: ${stageSequence.join(
      ", ",
    )} for session '${sessionId}'`,
  );
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
    console.error("Failed to generate test session", error);
  }
  process.exit(1);
});
