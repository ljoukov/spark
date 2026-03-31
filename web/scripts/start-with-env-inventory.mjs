import { spawn } from "node:child_process";

const entries = Object.entries(process.env).sort(([left], [right]) =>
  left.localeCompare(right),
);

console.log(
  `[startup-env] cwd=${process.cwd()} count=${entries.length.toString()}`,
);
for (const [key, value] of entries) {
  const length = value?.length ?? 0;
  console.log(`[startup-env] ${key} len=${length.toString()}`);
}

if (process.env.SPARK_PRINT_ENV_ONLY === "1") {
  console.log("[startup-env] SPARK_PRINT_ENV_ONLY=1, skipping server launch.");
  process.exit(0);
}

const child = spawn("bun", ["./index.js"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(
    `[startup-env] failed to launch bun ./index.js: ${error.message}`,
  );
  process.exit(1);
});
