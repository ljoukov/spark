import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

export function getTempFilePath(fileName: string) {
  return path.join(os.tmpdir(), fileName);
}

export async function writeUint8ArrayToTempFile(
  data: Uint8Array,
  fileName: string,
) {
  await fs.writeFile(getTempFilePath(fileName), data);
}

export async function readUint8ArrayFromTempFile(
  fileName: string,
): Promise<Uint8Array> {
  return new Uint8Array(await fs.readFile(getTempFilePath(fileName)));
}

export async function deleteTempFile(fileName: string) {
  await fs.unlink(getTempFilePath(fileName));
}
