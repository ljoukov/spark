import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeJson(
  filePath: string,
  data: unknown,
): Promise<void> {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

export async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
