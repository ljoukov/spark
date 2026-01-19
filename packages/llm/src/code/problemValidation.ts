import { loadPyodide } from "pyodide";
import { createRequire } from "node:module";
import path from "node:path";

import type { CodeProblem } from "@spark/schemas";

/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */

const PYODIDE_VERSION = "0.28.3";
const require = createRequire(import.meta.url);
const PYODIDE_PACKAGE_JSON_PATH = require.resolve("pyodide/package.json");
const PYODIDE_BASE_DIR = path.dirname(PYODIDE_PACKAGE_JSON_PATH);
const LOCAL_INDEX_URL = path.join(PYODIDE_BASE_DIR, path.sep);
const CDN_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const DEFAULT_INDEX_URL = LOCAL_INDEX_URL;

type PyodideStdIOConfig = {
  stdout: string[];
  stderr: string[];
};

type PythonExecutionResult = {
  stdout: string;
  stderr: string;
  errorMessage: string | null;
};

type ProblemValidationIssue = {
  slug: string;
  testIndex: number;
  message: string;
};

export class ProblemValidationError extends Error {
  public readonly issues: ProblemValidationIssue[];

  constructor(issues: ProblemValidationIssue[]) {
    const summary =
      issues.length === 1
        ? `Validation failed for ${issues[0]!.slug} (test ${issues[0]!.testIndex + 1}): ${issues[0]!.message}`
        : [
            `Validation failed for ${issues.length} tests:`,
            ...issues.map(
              (issue) =>
                `- ${issue.slug} (test ${issue.testIndex + 1}): ${issue.message}`,
            ),
          ].join("\n");
    super(summary);
    this.issues = issues;
  }
}

type ValidateProblemsOptions = {
  logger?: (message: string) => void;
  indexURL?: string;
};

let pyodideInstancePromise: ReturnType<typeof loadPyodide> | null = null;

type MutableGlobal = Omit<typeof globalThis, "location" | "self"> & {
  location?: { href: string };
  self?: typeof globalThis;
};

function resolveIndexUrl(explicit?: string): string {
  const fromEnv =
    process.env.PYODIDE_INDEX_URL ??
    process.env.PYODIDE_BASE_URL ??
    process.env.PYTHON_RUNTIME_INDEX_URL;
  const candidates = [
    explicit,
    fromEnv,
    DEFAULT_INDEX_URL,
    CDN_INDEX_URL,
  ].filter((value): value is string =>
    Boolean(value && value.trim().length > 0),
  );

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("file://")
    ) {
      return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
    }
    if (trimmed.endsWith(path.sep)) {
      return trimmed;
    }
    return `${trimmed}${path.sep}`;
  }

  return CDN_INDEX_URL;
}

function ensureGlobalEnvironment(indexURL: string): void {
  const globalObject = globalThis as MutableGlobal;
  if (!globalObject.location) {
    globalObject.location = { href: indexURL };
  } else if (!globalObject.location.href) {
    globalObject.location.href = indexURL;
  }
  if (!globalObject.self) {
    globalObject.self = globalThis;
  }
}

async function ensurePyodide(indexURL?: string) {
  if (!pyodideInstancePromise) {
    const resolvedIndex = resolveIndexUrl(indexURL);
    ensureGlobalEnvironment(resolvedIndex);
    pyodideInstancePromise = loadPyodide({ indexURL: resolvedIndex });
  }
  return pyodideInstancePromise;
}

function normalizeOutput(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function normalizePythonSource(code: string): string {
  return code.replace(/\r\n?/g, "\n").replace(/\\n/g, "\n");
}

function splitInputLines(raw: string): string[] {
  if (!raw) {
    return [];
  }
  return raw.replace(/\r\n?/g, "\n").replace(/\\n/g, "\n").split("\n");
}

async function runPythonWithStdIO(
  code: string,
  stdinInput: string,
  indexURL?: string,
): Promise<PythonExecutionResult> {
  const pyodide = await ensurePyodide(indexURL);

  const stdio: PyodideStdIOConfig = { stdout: [], stderr: [] };

  pyodide.setStdout({
    batched(text) {
      stdio.stdout.push(text);
    },
  });

  pyodide.setStderr({
    batched(text) {
      stdio.stderr.push(text);
    },
  });

  const lines = splitInputLines(stdinInput);
  let cursor = 0;

  pyodide.setStdin({
    stdin() {
      if (cursor >= lines.length) {
        return null;
      }
      const line = lines[cursor];
      cursor += 1;
      return `${line}\n`;
    },
  });

  try {
    const source = normalizePythonSource(code);
    await pyodide.runPythonAsync(source);
    return {
      stdout: stdio.stdout.join(""),
      stderr: stdio.stderr.join(""),
      errorMessage: null,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
    return {
      stdout: stdio.stdout.join(""),
      stderr: stdio.stderr.join(""),
      errorMessage: message,
    };
  } finally {
    try {
      pyodide.setStdout();
      pyodide.setStderr();
      pyodide.setStdin();
    } catch {
      // Intentionally swallow clean-up errors so validation can report primary failures.
    }
  }
}

export async function validateProblems(
  problems: readonly CodeProblem[],
  options: ValidateProblemsOptions = {},
): Promise<void> {
  const logger = options.logger ?? console.log;
  const indexURL = options.indexURL;
  const issues: ProblemValidationIssue[] = [];

  for (const problem of problems) {
    logger(`[validate] Running canonical solution for '${problem.slug}'`);
    const expectedExamples = problem.examples.slice(0, 3);
    for (let index = 0; index < problem.tests.length; index += 1) {
      const test = problem.tests[index];
      const normalizedExpected = normalizeOutput(test.output).trimEnd();
      const execution = await runPythonWithStdIO(
        problem.solution.code,
        test.input,
        indexURL,
      );
      const normalizedStdout = normalizeOutput(execution.stdout).trimEnd();

      if (execution.errorMessage) {
        issues.push({
          slug: problem.slug,
          testIndex: index,
          message: execution.errorMessage,
        });
        continue;
      }

      if (execution.stderr.trim().length > 0) {
        issues.push({
          slug: problem.slug,
          testIndex: index,
          message: `stderr not empty: ${execution.stderr.trim()}`,
        });
        continue;
      }

      if (normalizedStdout !== normalizedExpected) {
        issues.push({
          slug: problem.slug,
          testIndex: index,
          message: `expected '${normalizedExpected}' but received '${normalizedStdout}'`,
        });
        continue;
      }

      if (index < expectedExamples.length) {
        const example = expectedExamples[index];
        if (
          normalizeOutput(test.input).trim() !==
          normalizeOutput(example.input).trim()
        ) {
          issues.push({
            slug: problem.slug,
            testIndex: index,
            message: `input no longer matches example ${index + 1}`,
          });
        }
        if (
          normalizeOutput(test.output).trim() !==
          normalizeOutput(example.output).trim()
        ) {
          issues.push({
            slug: problem.slug,
            testIndex: index,
            message: `output no longer matches example ${index + 1}`,
          });
        }
        if (!test.explanation) {
          issues.push({
            slug: problem.slug,
            testIndex: index,
            message: `missing explanation for example ${index + 1}`,
          });
        }
      }
    }
  }

  if (issues.length > 0) {
    throw new ProblemValidationError(issues);
  }

  logger("[validate] All canonical solutions passed the configured tests.");
}
