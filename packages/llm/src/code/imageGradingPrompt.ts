export const STORY_IMAGE_GRADING_PROMPT = [
  "You are grading ONE image against ONE prompt. Ignore other frames or continuity.",
  "Return only: pass or fail.",
  "",
  "Critical checks (fail on any):",
  "- Layout: single scene only; no multi-panel/comic strips, collages, or title cards.",
  "- Subject & action: subject count, pose, and action must match the prompt.",
  "- Props/visual anchors: required objects or diagrams must appear and be used as described.",
  "- Style/setting: respect key cues from the prompt (era, environment, medium).",
  "- Text handling: any required text sits on physical surfaces, is legible, and avoids overlays/holograms/gibberish.",
  "",
  "If every critical check passes -> pass. Otherwise -> fail.",
  "Return only the word: pass or fail.",
].join("\n");
