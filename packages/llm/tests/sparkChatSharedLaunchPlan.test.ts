import { describe, expect, it } from "vitest";

import {
  buildSparkGraderLaunchPlan,
  buildSparkSheetDraftLaunchPlan,
} from "../src/agent/sparkChatShared";

describe("spark chat launch plans", () => {
  it("records the tool call time as launch plan creation time", () => {
    const now = new Date("2026-04-16T17:56:14.587Z");
    const graderPlan = buildSparkGraderLaunchPlan({
      input: {
        title: "GCSE Biology remark",
      },
      attachments: [],
      graderTaskTemplate: "# Task",
      now,
    });
    const sheetPlan = buildSparkSheetDraftLaunchPlan({
      input: {
        title: "Source paper worksheet",
      },
      attachments: [],
      sheetTaskTemplate: "# Task",
      now,
    });

    expect(graderPlan.createdAt).toBe(now);
    expect(graderPlan.requestPayload.createdAt).toBe(now.toISOString());
    expect(sheetPlan.createdAt).toBe(now);
    expect(sheetPlan.requestPayload.createdAt).toBe(now.toISOString());
  });

  it("disambiguates duplicate attachment filenames for grader runs", () => {
    const plan = buildSparkGraderLaunchPlan({
      input: {
        title: "GCSE Biology remark",
      },
      attachments: [
        {
          id: "a1b2c3d4e5",
          filename: "image.jpg",
          contentType: "image/jpeg",
          sizeBytes: 100,
          storagePath: "spark/uploads/test/a1b2c3d4e5",
        },
        {
          id: "f6g7h8i9j0",
          filename: "image.jpg",
          contentType: "image/jpeg",
          sizeBytes: 101,
          storagePath: "spark/uploads/test/f6g7h8i9j0",
        },
        {
          id: "z1y2x3w4v5",
          filename: "image.jpg",
          contentType: "image/jpeg",
          sizeBytes: 102,
          storagePath: "spark/uploads/test/z1y2x3w4v5",
        },
      ],
      graderTaskTemplate: "# Task",
    });

    expect(plan.runWorkspaceAttachments.map((attachment) => attachment.workspacePath)).toEqual([
      "grader/uploads/image.jpg",
      "grader/uploads/image-f6g7h8i9.jpg",
      "grader/uploads/image-z1y2x3w4.jpg",
    ]);
  });

  it("disambiguates duplicate attachment filenames for sheet draft runs", () => {
    const plan = buildSparkSheetDraftLaunchPlan({
      input: {
        title: "Worksheet",
      },
      attachments: [
        {
          id: "first-attachment",
          filename: "scan.pdf",
          contentType: "application/pdf",
          sizeBytes: 100,
          storagePath: "spark/uploads/test/first-attachment",
        },
        {
          id: "second-attachment",
          filename: "scan.pdf",
          contentType: "application/pdf",
          sizeBytes: 100,
          storagePath: "spark/uploads/test/second-attachment",
        },
      ],
      sheetTaskTemplate: "# Task",
    });

    expect(plan.runWorkspaceAttachments.map((attachment) => attachment.workspacePath)).toEqual([
      "grader/uploads/scan.pdf",
      "grader/uploads/scan-second-a.pdf",
    ]);
  });

  it("does not infer source-paper-only mode for grading runs with student work", () => {
    const plan = buildSparkGraderLaunchPlan({
      sourceText:
        "Please grade this uploaded exam paper and handwritten student work, preserving the paper structure in the rendered sheet.",
      input: {
        title: "GCSE Biology remark",
        notes:
          "Use the uploaded handwritten images as the student submission and the mark scheme for grading.",
      },
      attachments: [],
      graderTaskTemplate: "# Task",
    });

    expect(plan.requestPayload.sourcePaperOnlyNoStudent).toBeUndefined();
    expect(plan.requestPayload.input.sourcePaperOnlyNoStudent).toBeUndefined();
  });

  it("infers source-paper-only mode only for explicit no-student paper rendering", () => {
    const plan = buildSparkGraderLaunchPlan({
      sourceText:
        "Render this uploaded question paper as a worksheet. No student answers were provided; leave answers blank and do not include an answer key.",
      input: {
        title: "Competition paper",
      },
      attachments: [],
      graderTaskTemplate: "# Task",
    });

    expect(plan.requestPayload.sourcePaperOnlyNoStudent).toBe(true);
    expect(plan.requestPayload.input.sourcePaperOnlyNoStudent).toBe(true);
  });

  it("tells grader agents to refresh crop validation after final crop edits", () => {
    const plan = buildSparkGraderLaunchPlan({
      input: {
        title: "GCSE Biology remark",
      },
      attachments: [],
      graderTaskTemplate: "# Task",
    });

    const sourceImageCroppingSkill = plan.skillFiles.find(
      (skillFile) =>
        skillFile.path === "skills/source-image-cropping/SKILL.md",
    );

    expect(plan.prompt).toContain("skills/source-image-cropping/SKILL.md");
    expect(plan.graderTask).toContain("skills/source-image-cropping/SKILL.md");
    expect(sourceImageCroppingSkill?.content).toContain(
      "validation is stale",
    );
  });
});
