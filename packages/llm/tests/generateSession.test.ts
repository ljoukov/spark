import { describe, expect, it } from "vitest";
import type { CodingProblem } from "../src/code/generateSession";

const dummyServiceAccount = JSON.stringify({
  project_id: "test-project",
  client_email: "test@example.com",
  private_key:
    "-----BEGIN PRIVATE KEY-----\\nTESTKEY\\n-----END PRIVATE KEY-----",
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
  input_format_md: "One integer on stdin.",
  output_format_md: "One line with the answer.",
  constraints: ["constraint"],
  examples: [{ input: "1", output: "1" }],
  edge_cases: ["edge"],
  hints: ["hint"],
  solution_overview_md: "overview",
  reference_solution_py: "pass",
  tests: {
    public: [{ input: "1\n", output: "1" }],
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
    tests: {
      ...baseProblem.tests,
      ...((override.tests ?? {}) as CodingProblem["tests"]),
    },
  };
}

describe("runSolutionAgainstTests stdin/stdout", () => {
  it("executes the program with stdin and captures stdout", async () => {
    const problem = buildProblem({
      tests: {
        public: [{ input: "5", output: "5" }],
      },
    });
    const solution = `
import sys

def main() -> None:
    data = sys.stdin.read().strip()
    print(data)

if __name__ == "__main__":
    main()
`;
    const failures = await runSolutionAgainstTests(problem, solution);
    expect(failures).toEqual([]);
  });

  it("normalizes newlines and ignores trailing whitespace", async () => {
    const problem = buildProblem({
      tests: {
        public: [
          {
            input: "10\n",
            output: "20",
          },
        ],
      },
    });
    const solution = `
import sys

tokens = sys.stdin.read().split()
n = int(tokens[0])
sys.stdout.write(str(2 * n) + "\\r\\n\\n")
`;
    const failures = await runSolutionAgainstTests(problem, solution);
    expect(failures).toEqual([]);
  });

  it("reports runtime errors as test failures", async () => {
    const problem = buildProblem({
      id: "p2",
      tests: {
        public: [
          {
            input: "0\n",
            output: "ok",
          },
        ],
      },
    });
    const solution = `
import sys

value = int(sys.stdin.read().strip())
if value == 0:
    raise ValueError("boom")
print("ok")
`;
    const failures = await runSolutionAgainstTests(problem, solution);
    expect(failures.length).toBe(1);
    expect(failures[0]?.message).toContain("ValueError");
  });
});
