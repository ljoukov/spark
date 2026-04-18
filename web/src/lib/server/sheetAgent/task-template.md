Create one student-facing worksheet draft from the uploaded material.

Requirements:

1. Inspect every uploaded file before deciding the worksheet structure.
2. If the uploads are already a question sheet or exam page:
- preserve section headings, numbering, subpart labels, blanks, option sets, tables, and diagram/flow layouts as closely as possible;
- keep formulas and wording verbatim except for minimal OCR cleanup.
- treat the printed worksheet as canonical source material; do not rewrite it into a nicer or shorter worksheet.
- default to source-faithful transcription into the worksheet JSON rather than synthesis.
- do not merge questions, renumber them, or omit marks, labels, answer lines, or visual answer cues.
- mark uncertainty explicitly instead of guessing missing source text, symbols, or labels.
- allowed cleanup: obvious OCR character fixes, whitespace cleanup, Markdown/LaTeX encoding, and scanner-noise removal that does not change meaning.
- forbidden cleanup: synonym swaps, grammar polishing, inferred missing words, collapsing tables/flow layouts into prose, or moving instructions across sections.
3. If the uploads are notes, revision material, or exposition rather than a ready-made sheet:
   - build a concise worksheet grounded only in those uploads;
   - keep the topic coverage and difficulty faithful to the source.
4. Use only the supported worksheet question shapes:
   - `group`
   - `answer_bank`
   - `fill`
   - `cloze`
   - `mcq`
   - `lines`
   - `calc`
   - `match`
   - `spelling`
   - `flow`
5. Use Markdown for prompt text, theory text, hint text, and tables. Use LaTeX for maths expressions.
6. If a source question has subparts, keep the original numbering visible through `displayNumber` such as `9(a)` or `10(b)`.
   - When a question should show a shorter circular badge than its full source label, also set `badgeLabel`.
   - Example: use `displayNumber: "10(a)"` together with `badgeLabel: "a"`.
7. If one numbered source question carries shared context such as a stem, table, diagram, or “use the table below” instruction before subparts, encode that numbered parent as a `group` entry and place the shared Markdown/table in `group.prompt`. Do not move shared question context into `section.theory`.
8. Every printed question or subpart visible in the source must become a question object in the matching section. Do not leave a titled section empty when the source page contains questions there.
9. For `flow` questions:
   - keep the printed box/arrow sequence faithful to the source;
   - store each editable box under a stable box id;
   - use `initialValue` for any fixed box that is already given in the source.
   - list each `rows[].items` array in the same left-to-right visual order the student sees on the page.
   - use `direction: "rtl"` only when the arrows point right-to-left; do not reverse the item order in the JSON.
   - when a top row drops into a lower row, use `connectors` to link the relevant box ids vertically.
10. Write `sheet/output/draft.json` with this shape:

```json
{
  "schemaVersion": 1,
  "mode": "draft",
  "sheet": {
    "id": "string",
    "subject": "string",
    "level": "string",
    "title": "string",
    "subtitle": "string",
    "color": "#36587A",
    "accent": "#4D7AA5",
    "light": "#E8F2FB",
    "border": "#BFD0E0",
    "sections": []
  },
  "references": {
    "problemMarkdown": "optional markdown"
  }
}
```

The `sheet.sections` array must use the paper-sheet structure directly:

- Hook section example:

```json
{
  "type": "hook",
  "text": "Short student-facing intro or instruction block in Markdown."
}
```

- Content section example:

```json
{
  "id": "A",
  "label": "Section A",
  "theory": "Optional Markdown theory / instructions.",
  "questions": []
}
```

Question shape quick reference:

- `group`

```json
{
  "id": "q10",
  "type": "group",
  "displayNumber": "10",
  "prompt": "For Question 10, use the table below.\n\n| Duration of deposit | Before | After |\n| --- | ---: | ---: |\n| 2 years | 4.14% | 3.06% |",
  "questions": [
    {
      "id": "q10a",
      "type": "fill",
      "displayNumber": "10(a)",
      "badgeLabel": "a",
      "marks": 1,
      "prompt": "The difference is £",
      "blanks": [{}],
      "after": "."
    },
    {
      "id": "q10b",
      "type": "lines",
      "displayNumber": "10(b)",
      "badgeLabel": "b",
      "marks": 1,
      "prompt": "Explain which option earns more interest.",
      "lines": 4
    }
  ]
}
```

Use `group` when the source prints one numbered question with shared context and multiple answer-bearing subparts. The child `questions[]` hold the real answer boxes and marks.
- Use `badgeLabel` only for display chrome such as compact subpart circles. Keep `displayNumber` source-faithful.

- Never invent placeholder copy for blanks or empty boxes. Leave `placeholder` omitted unless the source itself prints placeholder text.
- If the printed source shows a short numeric answer line such as `Answer ____ £`, prefer `calc` (or `fill` when the answer sits inline in a sentence) instead of `lines`.

- `fill`

```json
{
  "id": "q1",
  "type": "fill",
  "displayNumber": "1",
  "marks": 1,
  "prompt": "The reciprocal of",
  "blanks": [{}],
  "after": "is ...",
  "conjunction": ""
}
```

`fill` questions must use this exact `prompt` + `blanks` + `after` shape, and every `fill` question must include `marks`. Do not replace visible blanks with prose-only `problemMarkdown`, and do not omit the question JSON just because the answer is short.

- `answer_bank`

```json
{
  "id": "q1",
  "type": "answer_bank",
  "displayNumber": "1",
  "marks": 1,
  "displayMode": "inline_labeled",
  "segments": [
    "£1000 is called ",
    ", the monthly interest rate is ",
    ", the annual interest rate is ",
    " and the accrued amount is ",
    "."
  ],
  "blanks": [{}, {}, {}, {}],
  "options": [
    { "id": "A", "label": "A", "text": "£1030" },
    { "id": "B", "label": "B", "text": "3%" },
    { "id": "C", "label": "C", "text": "0.25%" },
    { "id": "D", "label": "D", "text": "principal amount" }
  ]
}
```

Use `answer_bank` when the source prints visible blanks plus a fixed option bank such as `(A)` to `(D)` underneath. Keep the sentence structure in `segments[]`, keep each source label in `options[].label`, and use stable option ids for the student answer state. Do not flatten these into `cloze` with a passive word bank.
Use `displayMode: "inline_labeled"` by default when the full labelled option such as `(A) principal amount` should appear inside each selector. Use `displayMode: "banked"` only when the source shows a separate visible answer bank that should remain on screen below the sentence or when the full labelled option text is too long to fit cleanly inside the selector.
`segments[]` must read like normal prose around the interactive blanks. Do not include decorative `(____)` wrappers, underscore runs, or dangling `)` / `]` characters copied from the printed blank markers.

- `cloze`

```json
{
  "id": "q2",
  "type": "cloze",
  "displayNumber": "2",
  "marks": 2,
  "segments": ["First sentence with ", " one blank and ", " another blank."],
  "blanks": [{}, {}]
}
```

Use `cloze` for inline free-response blanks where the student should type short answers, not for source-printed answer banks.

- `mcq`

```json
{
  "id": "q3",
  "type": "mcq",
  "displayNumber": "3",
  "marks": 1,
  "prompt": "Choose the correct answer.",
  "displayMode": "full_options",
  "options": [
    { "id": "A", "label": "A", "text": "First option" },
    { "id": "B", "label": "B", "text": "Second option" },
    { "id": "C", "label": "C", "text": "Third option" },
    { "id": "D", "label": "D", "text": "Fourth option" }
  ]
}
```

Use `displayMode: "full_options"` by default when the selectable cards themselves should show the full option text. Use `displayMode: "labels_only"` only when long source options should stay listed separately above compact label-only selectors.

- `lines`

```json
{
  "id": "q4",
  "type": "lines",
  "displayNumber": "4(b)",
  "marks": 3,
  "prompt": "Explain your reasoning in Markdown if needed.",
  "lines": 6,
  "renderMode": "markdown"
}
```

- `calc`

```json
{
  "id": "q5",
  "type": "calc",
  "displayNumber": "5",
  "marks": 1,
  "prompt": "Work out the value.",
  "hint": "Optional short hint.",
  "inputLabel": "Answer",
  "unit": ""
}
```

- `match`

```json
{
  "id": "q6",
  "type": "match",
  "displayNumber": "6",
  "marks": 2,
  "prompt": "Match each item.",
  "pairs": [
    { "term": "A", "match": "1" },
    { "term": "B", "match": "2" }
  ]
}
```

- `spelling`

```json
{
  "id": "q7",
  "type": "spelling",
  "displayNumber": "7",
  "marks": 1,
  "prompt": "Correct the spelling.",
  "words": [{ "wrong": "teh" }]
}
```

- `flow`

```json
{
  "id": "q8",
  "type": "flow",
  "displayNumber": "8",
  "marks": 2,
  "prompt": "Complete the flow chart.",
  "boxes": [
    { "id": "b1", "initialValue": "3", "readonly": true },
    { "id": "b2" },
    { "id": "b3" }
  ],
  "rows": [
    {
      "direction": "ltr",
      "items": [
        { "type": "box", "boxId": "b1" },
        { "type": "operation", "label": "× 2" },
        { "type": "box", "boxId": "b2" }
      ]
    },
    {
      "direction": "rtl",
      "items": [
        { "type": "box", "boxId": "b3" },
        { "type": "operation", "label": "+ 1" },
        { "type": "box", "boxId": "b2" }
      ]
    }
  ],
  "connectors": [{ "fromBoxId": "b2", "toBoxId": "b3", "label": "then", "direction": "down" }]
}
```

Use these exact field names. Do not invent alternate keys such as `promptMarkdown`, `items`, `kind`, `choices`, or `questionNumber`.

11. Write `sheet/output/run-summary.json` with this shape:

```json
{
  "presentation": {
    "title": "string",
    "subtitle": "string",
    "summaryMarkdown": "string",
    "footer": "string"
  },
  "sheet": {
    "title": "string",
    "filePath": "sheet/output/draft.json"
  }
}
```

12. `presentation.title`, `presentation.subtitle`, `presentation.summaryMarkdown`, and `presentation.footer` must stay student-facing and must not mention IDs, file paths, tools, or internal process notes.
    - `presentation.subtitle` should be a short factual header line about the uploaded worksheet or current state.
    - `presentation.summaryMarkdown` is the body copy for the list card and should not repeat marks or percentages.
    - `presentation.footer` should be a terse provenance/source line rather than a repeated title.
    - `presentation.summaryMarkdown` should be one compact sentence or two short fragments for the Sheets thumbnail; do not repeat the title, subject, level, marks, percentage, created date, or footer, and avoid generic lead-ins such as "This sheet" or "The worksheet".
13. Map the worksheet subject to Spark's stable Apple-style palette and use the matching values for `sheet.color`, `sheet.accent`, `sheet.light`, and `sheet.border`: Biology green; Mathematics blue; Chemistry purple; Physics indigo; Geography teal; Science mint; English pink; History or Religious Studies orange; Economics or Business yellow; Computer Science or General gray. Do not invent custom sheet colors.
14. Do not try to infer the schema from logs or unrelated files. The contract above is the one to follow.
15. After both files exist, call `publish_sheet_draft({})`.
16. Do not call `done` before `publish_sheet_draft` succeeds.
17. Recommended workflow:
   - first run one `extract_text` call that covers every uploaded document;
   - if the upload is already a worksheet / exam page, always run `pdf_to_images` and inspect every relevant page image (or crop) with `view_image` before drafting;
   - if the upload is not already a worksheet but layout still matters, inspect the relevant page images with `view_image`;
   - if `pdf_to_images` or `view_image` fails for a printed worksheet / exam page, stop and fix or report that failure instead of publishing a partial text-only worksheet;
   - before `publish_sheet_draft({})`, compare the draft against extracted text and viewed source pages; fix any paraphrase, omission, reorder, guessed OCR, or invented placeholder text.
   - then write the two JSON files, call `publish_sheet_draft({})`, and fix any reported validation issues.
   - if the upload is already a worksheet / exam page, transcribe that structure rather than synthesizing a new worksheet.
