import { describe, expect, it } from "vitest";

import { resolvePdfiumWasmAssetUrl } from "../src/utils/pdfium";

describe("resolvePdfiumWasmAssetUrl", () => {
  it("maps Vite SSR public asset URLs back into the server build tree", () => {
    expect(
      resolvePdfiumWasmAssetUrl({
        assetUrl: "/_app/immutable/assets/pdfium.test.wasm",
        moduleUrl: "file:///usr/src/app/build/server/chunks/sparkAgentRunner.js",
      }),
    ).toBe(
      "file:///usr/src/app/build/server/_app/immutable/assets/pdfium.test.wasm",
    );
  });

  it("converts absolute filesystem paths to file URLs", () => {
    expect(
      resolvePdfiumWasmAssetUrl({
        assetUrl: "/tmp/pdfium.wasm",
        moduleUrl: "file:///usr/src/app/build/server/chunks/sparkAgentRunner.js",
      }),
    ).toBe("file:///tmp/pdfium.wasm");
  });

  it("passes through file URLs unchanged", () => {
    expect(
      resolvePdfiumWasmAssetUrl({
        assetUrl: "file:///tmp/pdfium.wasm",
        moduleUrl: "file:///usr/src/app/build/server/chunks/sparkAgentRunner.js",
      }),
    ).toBe("file:///tmp/pdfium.wasm");
  });

  it("maps Vite dev @fs asset paths to file URLs", () => {
    expect(
      resolvePdfiumWasmAssetUrl({
        assetUrl: "/@fs/Users/dev/project/node_modules/@hyzyla/pdfium/pdfium.wasm",
        moduleUrl: "file:///Users/dev/project/web/.svelte-kit/output/server/chunks/sparkAgentRunner.js",
      }),
    ).toBe("file:///Users/dev/project/node_modules/@hyzyla/pdfium/pdfium.wasm");
  });

  it("maps Vite dev @fs asset URLs served over http back to file URLs", () => {
    expect(
      resolvePdfiumWasmAssetUrl({
        assetUrl:
          "http://localhost:5173/@fs/Users/dev/project/node_modules/@hyzyla/pdfium/pdfium.wasm",
        moduleUrl: "file:///Users/dev/project/web/.svelte-kit/output/server/chunks/sparkAgentRunner.js",
      }),
    ).toBe("file:///Users/dev/project/node_modules/@hyzyla/pdfium/pdfium.wasm");
  });
});
