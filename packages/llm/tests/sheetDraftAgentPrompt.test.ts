import { describe, expect, it } from "vitest";

import { buildSparkSheetDraftAgentPrompt } from "../src/agent/sheetDraftAgentPrompt";
import {
  renderSparkSheetDraftTask,
  SPARK_CHAT_CREATE_SHEET_TOOL_DESCRIPTION,
} from "../src/agent/sparkChatShared";

describe("sheet draft prompt", () => {
  it("requires source-fidelity checks before publish", () => {
    const prompt = buildSparkSheetDraftAgentPrompt();

    expect(prompt).toContain(
      "Before publish, compare the worksheet draft against extracted text and viewed source pages.",
    );
    expect(prompt).toContain(
      "publish_sheet_draft({}) to validate and publish the worksheet draft; this only validates the artifact contract/persistence",
    );
    expect(prompt).toContain("Mark uncertainty explicitly instead of guessing");
    expect(prompt).toContain(
      "Do not leave a titled section empty when the source page shows questions there.",
    );
  });

	it("keeps the extraction workflow visual-first for printed worksheets", () => {
		const task = renderSparkSheetDraftTask("# Task");

    expect(task).toContain(
      "always run `pdf_to_images` and inspect every relevant page or crop with `view_image` before drafting",
    );
    expect(task).toContain(
      "Never invent placeholder copy for blanks or empty boxes unless the source prints it.",
    );
    expect(task).toContain(
      "If `pdf_to_images` or `view_image` fails for a printed worksheet or exam page, stop and fix or report that failure instead of publishing a partial text-only worksheet.",
    );
    expect(task).toContain(
      "`publish_sheet_draft` only validates schema/persistence",
    );
		expect(task).toContain(
			"`fill` questions must use the real schema shape with `prompt`, `blanks`, `after`, optional `conjunction`, and `marks`.",
		);
		expect(task).toContain(
			"Use `answer_bank` when the source prints visible blanks plus a fixed option bank such as `(A)` to `(D)`",
		);
		expect(task).toContain(
			"For `answer_bank`, `segments[]` must be clean prose around the interactive blanks.",
		);
	});

  it("tells the chat tool to reuse earlier uploads for worksheet requests", () => {
    expect(SPARK_CHAT_CREATE_SHEET_TOOL_DESCRIPTION).toContain(
      "If the request refers to an earlier upload in the same conversation",
    );
  });
});
