import { describe, expect, it } from "vitest";
import type { CodingProblem } from "../src/code/generateSession";

const dummyServiceAccount = JSON.stringify({
  project_id: "test-project",
  client_email: "test@example.com",
  private_key: "-----BEGIN PRIVATE KEY-----\\nTESTKEY\\n-----END PRIVATE KEY-----",
});

if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = dummyServiceAccount;
}

const { runSolutionAgainstTests } = await import("../src/code/generateSession");

const baseProblem: Omit<CodingProblem, "id"> = {
  title: "Test Problem",
  difficulty: "easy",
  story_callback: "callback",
  statement_md: "statement",
  function: {
    name: "",
    signature: "",
    params: [],
    returns: "int",
  },
  constraints: ["constraint"],
  examples: [{ input: "1", output: "1" }],
  edge_cases: ["edge"],
  hints: ["hint"],
  solution_overview_md: "overview",
  reference_solution_py: "pass",
  tests: {
    public: [],
  },
};

function buildProblem(
  override: Partial<CodingProblem>,
  id: "p1" | "p2" = "p1",
): CodingProblem {
  return {
    ...baseProblem,
    ...override,
    id,
    function: {
      ...baseProblem.function,
      ...((override.function ?? {}) as CodingProblem["function"]),
    },
    tests: {
      ...baseProblem.tests,
      ...((override.tests ?? {}) as CodingProblem["tests"]),
    },
  };
}

describe("runSolutionAgainstTests parse_args", () => {
  it("pads trailing memo parameters when omitted", async () => {
    const problem = buildProblem({
      function: {
        name: "calculate_paperwork",
        signature: "def calculate_paperwork(n: int, memo: dict = None) -> int:",
        params: [
          { name: "n", type: "int" },
          { name: "memo", type: "dict" },
        ],
        returns: "int",
      },
      tests: {
        public: [{ input: "5", output: "5" }],
      },
    });
    const solution = `
def calculate_paperwork(n: int, memo: dict = None) -> int:
    if memo is None:
        memo = {}
    memo[n] = memo.get(n, n)
    return n
`;
    const failures = await runSolutionAgainstTests(problem, solution);
    expect(failures).toEqual([]);
  });

  it("parses comma-separated named arguments at top level", async () => {
    const grid = ["ABC", "DEF", "GHI"];
    const problem = buildProblem({
      function: {
        name: "get_value",
        signature: "def get_value(grid: list[str], row: int, col: int) -> str:",
        params: [
          { name: "grid", type: "list[str]" },
          { name: "row", type: "int" },
          { name: "col", type: "int" },
        ],
        returns: "str",
      },
      tests: {
        public: [
          {
            input: 'grid=["ABC", "DEF", "GHI"], row=1, col=2',
            output: "F",
          },
        ],
      },
    });
    const solution = `
def get_value(grid: list[str], row: int, col: int) -> str:
    return grid[row][col]
`;
    const failures = await runSolutionAgainstTests(problem, solution);
    expect(failures).toEqual([]);
  });

  it("does not split commas inside string or list literals", async () => {
    const problem = buildProblem({
      id: "p2",
      function: {
        name: "first_char",
        signature: "def first_char(grid: list[str], row: int, col: int) -> str:",
        params: [
          { name: "grid", type: "list[str]" },
          { name: "row", type: "int" },
          { name: "col", type: "int" },
        ],
        returns: "str",
      },
      tests: {
        public: [
          {
            input: 'grid=["a,b", "cd"], row=0, col=0',
            output: "a",
          },
        ],
      },
    });
    const solution = `
def first_char(grid: list[str], row: int, col: int) -> str:
    return grid[row][col]
`;
    const failures = await runSolutionAgainstTests(problem, solution);
    expect(failures).toEqual([]);
  });
});
