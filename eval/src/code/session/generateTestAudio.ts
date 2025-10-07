// Script: generateTestAudio.ts
// Purpose: Produce mock audio transcripts (intro/outro) for the DP test session
// Output: Prints clearly formatted slides and narration to the console.

type Speaker = "m" | "f";

export type NarrationLine = {
  speaker: Speaker;
  text: string;
};

export type MediaSegment = {
  slide: string; // markdown describing what to show on screen
  narration: NarrationLine[]; // lines in speaking order
};

function buildIntro(): MediaSegment[] {
  const segments: MediaSegment[] = [
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

  return segments;
}

function buildOutro(): MediaSegment[] {
  const segments: MediaSegment[] = [
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

  return segments;
}

function printSegments(label: string, segments: MediaSegment[]): void {
  // Human‑friendly section
  console.log(`\n=== ${label.toUpperCase()} (${segments.length} slides) ===`);
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    console.log(`\nSlide ${i + 1}`);
    console.log("Slide markdown:");
    console.log(s.slide);
    console.log("Narration:");
    for (const line of s.narration) {
      const speaker = line.speaker === "m" ? "M" : "F";
      console.log(`- ${speaker}: ${line.text}`);
    }
  }

  // Raw JSON section (copy‑pasteable)
  console.log(`\n${label} JSON:`);
  console.log(JSON.stringify(segments, null, 2));
}

async function main(): Promise<void> {
  const intro = buildIntro();
  const outro = buildOutro();
  printSegments("Intro", intro);
  printSegments("Outro", outro);
}

main().catch((err) => {
  console.error("Failed to generate test audio segments", err);
  process.exit(1);
});

