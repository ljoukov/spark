export type ZodSchemaLike = {
  parse: (value: unknown) => unknown;
  safeParse: (value: unknown) => { success: boolean };
};

export type FunctionToolLike = {
  inputSchema: ZodSchemaLike;
  execute: (input: unknown) => unknown;
};

export function requireFunctionTool(tool: unknown): asserts tool is FunctionToolLike {
  if (!tool || typeof tool !== "object") {
    throw new Error("Expected tool to be a non-null object.");
  }

  const record = tool as Record<string, unknown>;
  if (!("inputSchema" in record)) {
    throw new Error("Expected tool to define inputSchema (function tool).");
  }
  if (typeof record.execute !== "function") {
    throw new Error("Expected tool.execute to be a function.");
  }
}

