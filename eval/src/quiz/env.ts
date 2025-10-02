import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadLocalEnv } from "@spark/llm/utils/env";

const QUIZ_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(QUIZ_DIR, "..");
const APP_ROOT = path.resolve(SRC_ROOT, "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..");
const WEB_ROOT = path.join(REPO_ROOT, "web");
const DOWNLOADS_DIR = path.join(REPO_ROOT, "spark-data", "downloads");
const EVAL_INPUT_DIR = path.join(REPO_ROOT, "spark-data", "eval-input");
const EVAL_OUTPUT_DIR = path.join(REPO_ROOT, "spark-data", "eval-output");
const AUDIT_REPORT_DIR = path.join(REPO_ROOT, "spark-data", "eval-audit");

loadLocalEnv();

export const QUIZ_PATHS = {
  quizDir: QUIZ_DIR,
  evalRoot: APP_ROOT,
  webRoot: WEB_ROOT,
  repoRoot: REPO_ROOT,
  downloadsDir: DOWNLOADS_DIR,
  evalInputDir: EVAL_INPUT_DIR,
  evalOutputDir: EVAL_OUTPUT_DIR,
  auditReportDir: AUDIT_REPORT_DIR,
} as const;
