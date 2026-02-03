import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadLocalEnv, loadEnvFromFile } from "@spark/llm/utils/env";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const UTILS_DIR = path.dirname(CURRENT_FILE);
const SRC_ROOT = path.resolve(UTILS_DIR, "..");
const EVAL_ROOT = path.resolve(SRC_ROOT, "..");
const REPO_ROOT = path.resolve(EVAL_ROOT, "..");
const WEB_ROOT = path.join(REPO_ROOT, "web");
const SPARK_DATA_ROOT = path.join(REPO_ROOT, "spark-data");
const QUIZ_ROOT = path.join(SPARK_DATA_ROOT, "quiz");
const CODE_ROOT = path.join(SPARK_DATA_ROOT, "code");

export const WORKSPACE_PATHS = {
  repoRoot: REPO_ROOT,
  evalRoot: EVAL_ROOT,
  srcRoot: SRC_ROOT,
  webRoot: WEB_ROOT,
  sparkDataRoot: SPARK_DATA_ROOT,
  quizRoot: QUIZ_ROOT,
  quizDownloadsDir: path.join(QUIZ_ROOT, "downloads"),
  quizEvalInputDir: path.join(QUIZ_ROOT, "eval-input"),
  quizEvalOutputDir: path.join(QUIZ_ROOT, "eval-output"),
  quizAuditDir: path.join(QUIZ_ROOT, "eval-audit"),
  quizTasksDir: path.join(QUIZ_ROOT, "tasks"),
  quizUnitTestsDir: path.join(QUIZ_ROOT, "unit-tests"),
  quizSamplesDir: path.join(QUIZ_ROOT, "samples-organized"),
  codeRoot: CODE_ROOT,
  codeDownloadsDir: path.join(CODE_ROOT, "downloads"),
  codeSyntheticDir: path.join(CODE_ROOT, "synthetic"),
  codeAudioDir: path.join(CODE_ROOT, "audio"),
} as const;

let envLoaded = false;

export function ensureEvalEnvLoaded(): void {
  if (envLoaded) {
    return;
  }

  loadLocalEnv();

  const envCandidates = [
    path.join(REPO_ROOT, ".env.local"),
    path.join(EVAL_ROOT, ".env.local"),
    path.join(WEB_ROOT, ".env.local"),
  ];

  for (const candidate of envCandidates) {
    loadEnvFromFile(candidate, { override: false });
  }

  envLoaded = true;
}
