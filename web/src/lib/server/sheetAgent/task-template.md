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
7. For `flow` questions:
   - keep the printed box/arrow sequence faithful to the source;
   - store each editable box under a stable box id;
   - use `initialValue` for any fixed box that is already given in the source.
   - list each `rows[].items` array in the same left-to-right visual order the student sees on the page.
   - use `direction: "rtl"` only when the arrows point right-to-left; do not reverse the item order in the JSON.
   - when a top row drops into a lower row, use `connectors` to link the relevant box ids vertically.
8. Write `sheet/output/draft.json` with this shape:

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

- Never invent placeholder copy for blanks or empty boxes. Leave `placeholder` omitted unless the source itself prints placeholder text.

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

- `cloze`

```json
{
  "id": "q2",
  "type": "cloze",
  "displayNumber": "2",
  "marks": 2,
  "segments": ["First sentence with ", " one blank and ", " another blank."],
  "blanks": [{}, {}],
  "wordBank": ["optional", "word", "bank"]
}
```

- `mcq`

```json
{
  "id": "q3",
  "type": "mcq",
  "displayNumber": "3",
  "marks": 1,
  "prompt": "Choose the correct answer.",
  "options": ["A", "B", "C", "D"]
}
```

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

9. Write `sheet/output/run-summary.json` with this shape:

```json
{
  "presentation": {
    "title": "string",
    "summaryMarkdown": "string"
  },
  "sheet": {
    "title": "string",
    "filePath": "sheet/output/draft.json"
  }
}
```

10. `presentation.title` and `presentation.summaryMarkdown` must stay student-facing and must not mention IDs, file paths, tools, or internal process notes.
11. Do not try to infer the schema from logs or unrelated files. The contract above is the one to follow.
12. After both files exist, call `publish_sheet_draft({})`.
13. Do not call `done` before `publish_sheet_draft` succeeds.
14. Recommended workflow:
   - first run one `extract_text` call that covers every uploaded document;
   - if the upload is already a worksheet / exam page, always run `pdf_to_images` and inspect every relevant page image (or crop) with `view_image` before drafting;
   - if the upload is not already a worksheet but layout still matters, inspect the relevant page images with `view_image`;
   - before `publish_sheet_draft({})`, compare the draft against extracted text and viewed source pages; fix any paraphrase, omission, reorder, guessed OCR, or invented placeholder text.
   - then write the two JSON files, call `publish_sheet_draft({})`, and fix any reported validation issues.
   - if the upload is already a worksheet / exam page, transcribe that structure rather than synthesizing a new worksheet.
