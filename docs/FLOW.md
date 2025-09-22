# Spark — One‑Button GCSE Triple Science Tutor (Flow & UX)

> **Core intent (plain English):** turn a student’s own school materials into quick, tailored practice with clear feedback and a calm next step—no busywork, no gimmicks.

---

## 1) What Spark Promises (Student Goals)

- ✅ **Use your own stuff:** Snap a **photo** or **upload a PDF** of a **textbook Q&A page** or a **teacher summary sheet**, and Spark turns it into practice that matches your school work.
- 🎯 **Be exam‑board aware:** Map every question to **Biology, Chemistry, Physics** topics on **AQA / Edexcel / OCR** so it lines up with the UK **GCSE** curriculum and timeline.
- 🧭 **Always know the next step:** After each short practice burst, get a **calm summary** and one **clear recommendation** (“Focus Balancing Equations, 6 mins”).
- 🪄 **One‑button simplicity:** The whole app revolves around **one big button**: **Scan or Upload**. Everything else happens automatically or in a single tap.
- 🧘 **No noisy gamification:** No coins, streak panic, or fireworks—just **confidence‑building feedback** and gentle momentum.

**Definitions (plain English)**

- 📚 **GCSE Triple Science:** Three separate GCSEs—**Biology**, **Chemistry**, **Physics**—usually taken in Years 10–11 in England/Wales with grades **9–1**.
- 🧾 **Q&A page:** A worksheet or textbook page with **questions and answers** (often including **mark scheme** style answers).
- 📝 **Teacher summary:** A “what to remember” sheet—keywords, formulas, and short explanations.
- 🧩 **Spaced repetition:** Revisiting the right things at the right time so you remember them longer (little and often).

---

## 2) Experience Principles (Design DNA)

- 🧼 **Clarity:** One primary action per view; short copy; obvious CTAs.
- 🪶 **Deference:** Let the content shine—neutral surfaces, readable type, generous whitespace.
- 🧱 **Depth (only where helpful):** Light motion and layering to show hierarchy (sheets, drawers).
- 🧠 **Confidence, not fireworks:** Calm affirmations; exact pointers to improve; no gamified noise.
- ♿ **Accessible by default:** High contrast; ≥44px tap targets; keyboard friendly; captions/tooltips.

---

## 3) The One‑Button Flow (End‑to‑End)

```

Home (One Button)
↓
Scan or Upload (Photo/PDF)
↓
Auto‑Understand (Q\&A vs Summary → Subject/Topic/Board)
↓
Generate Tailored Practice (10± items, 4–7 min)
↓
Do Practice (simple, focused player)
↓
Calm Summary (grade band hint, 1–2 focus topics, next action)
↓
Light Progress View (Subjects • Timeline • Numbers)
↺

```

---

## 4) Home (Single‑Screen Shell)

- 🟢 **Primary CTA (big button):** **Scan or Upload**.
- 🔁 **“Continue” card (when relevant):** Resume last practice in one tap.
- 🔍 **Subtle insight strip:** “Top focus: Electricity (Accuracy 58%).” Tap → practise that topic now.
- 📎 **Helper tips (collapsible):** Good lighting, crop page, multi‑page allowed.

> **Why this matters:** Students open the app, hit **one button**, and are practising within seconds.

---

## 5) Capture → Understand

**5.1 Capture**

- 📷 **Snap Photo** or 📄 **Upload PDF** (multi‑page OK).
- ✂️ **Quick crop/rotate** and page order confirmation.
- 💡 **Quality hints:** Lighting, fill the frame, avoid glare.

**5.2 Auto‑Understand (on submit)**

- 🧭 **Classify page type:** **Q&A** vs **Summary**.
- 🧪 **Detect subject & topic:** Biology / Chemistry / Physics; map to board topic tree.
- 🔎 **Extract structure:**
  - Q&A: find each question, its answer, and any mark‑scheme cues.
  - Summary: extract key facts, equations, definitions, diagrams.

**5.3 Confirm (5–10 sec sheet)**

- 🏷️ **Show: subject, topic(s), board guess, page type.**
- ✏️ **Edit chips** if needed (rare).
- ▶️ **Start practice** (primary) — or **Generate & start** auto‑continues if user does nothing.

---

## 6) Tailored Practice Generation

- 🧩 **If Q&A page:**
  - 🔁 **Check‑my‑answer mode:** Hide the printed answer; student answers first; reveal **step‑by‑step** reasoning; match to **mark‑scheme points**.
  - 🧭 **Mix types** (MCQ, free‑text, numeric, true/false) derived from each question; allow **partial credit**.
- 🧠 **If Summary page:**

  - 🃏 **Rapid recall cards:** definitions, key facts, “fill‑the‑gap” items.
  - 🧮 **Formula prompts** with units & **significant figures** guidance (Chem/Phys).
  - 🗺️ **Mini‑diagrams** (label parts) when the sheet includes imagery.

- 🧱 **Question rules (keep it simple):**
  - ⏱️ **10± questions** or **~5–7 minutes** per set.
  - 🧪 **Chem/Phys numeric:** tolerance and units picker; highlight sig figs.
  - ✍️ **Free‑text:** short rubric with matched key phrases.
  - 🧷 **Flag** or **Skip** stays tucked in an overflow menu.

---

## 7) Practice Player (Calm & Consistent)

- 🧭 **Header:** Subject colour, _Question x/y_, small progress bar.
- 💬 **Hint pill (optional):** One tap reveals a single scaffolded nudge.
- 🖱️ **Input styles:**
  - 🔘 **MCQ:** large, tappable tiles (A–D).
  - ✍️ **Short free‑text:** minimal box; “Check answer”.
  - 🔢 **Numeric:** value + **unit picker**; show tolerance.
  - 🔁 **True/False:** two big buttons.
  - 🏷️ **Label diagram:** drag labels; zoom controls.
- 🧾 **Feedback pattern (always the same):**
  - ✅ **Correct / Partial / Try again** + **why** (short explanation).
  - 🔍 Link to **mark‑scheme points** when relevant (for Q&A pages).

---

## 8) Summary → Next Step (After Each Set)

- 📊 **Calm results card:** accuracy %, **estimated grade band (9–1)** trend, strongest/weakest topic.
- 🎯 **One clear next action:** e.g., “Practise **Electric circuits** (6 mins)”.
- 🔁 **Generate more like this:** same page/topic, adjusted difficulty.
- 🗒️ **Review explanations** (optional) — opens a sheet, not a new page.
- 💬 **Reflection chips:** “Felt confident” / “Need more practice” feed the timeline.

---

## 9) Light Progress (Three Lenses, One Surface)

> **Design note:** Keep this all on one page with a **segmented switcher** and **inline cards**—no extra navigation.

- 🧬 **Subjects lens (default):**

  - 🟢 Biology • 🔷 Chemistry • 🟣 Physics cards with **accuracy** and **top 2 weak topics**.
  - ▶️ **Practise topic** button on each weak chip.

- 🗓️ **Timeline lens:**

  - 📅 Day cards: “Mon 10 Mar — 2 sets • 12 mins • Focus: Genetics”.
  - 💬 Reflection snippet and link to review.

- 🔢 **Numbers lens:**
  - 📈 **Questions answered**, **accuracy trend**, **time spent**, **grade band estimate**.
  - 🧠 **Recommendation rail** (2–3 cards): “This week: **Balancing equations**” with **Practise now**.

---

## 10) Personalisation to School Work (Tutor‑like, not a textbook)

- 🧩 **Board & topic mapping:** Every item tags to **AQA/Edexcel/OCR** topic codes where possible.
- 🗂️ **Keep your teacher’s framing:** Use the wording and structure from the **uploaded page**; we **don’t swap** it for generic content.
- 🗓️ **Timeline aware:** Light nudge towards **upcoming topics** (based on school term or past paper sections the class is on).
- 🧵 **Set continuity:** New sets default to **the last upload’s context** so study feels consistent with classwork.

---

## 11) Visual & Interaction Notes

- 🎨 **Subject colours:** Bio = green, Chem = teal, Phys = indigo; neutral background.
- ✍️ **Typography:** Large, readable headings; simple body text; UK spelling.
- 🧩 **Components:** Cards with 8–12px radius; subtle elevation; AA contrast.
- 🎞️ **Motion:** Cross‑fades and short slides (<300ms), **no confetti** by default.
- 🌓 **Dark mode parity** and reduced motion toggle.

---

## 12) Accessibility & Inclusivity

- ♿ **Contrast ≥ 4.5:1**, focus rings, keyboard navigation, alt text for images.
- 🙌 **Tap targets ≥ 44×44 px**; error/success messages are screen‑reader friendly.
- 🌍 **Inclusive mock names** and examples; symbols explained in plain English.

---

## 13) Data (for Prototyping & Tests)

- 🧪 **Fixtures:**
  - 📂 Uploads (photo/PDF): timestamp, type, subject guess, page type.
  - 🧰 Quizzes: 10–12 items with `type`, `prompt`, `answer`, `explanation`, `units/tolerance` (where relevant), `topicPath`, `board`.
  - 🗓️ Timeline: entries for upload → practice → summary.
  - 📈 Metrics: total Qs, accuracy %, grade band estimate (with confidence).
- 🧪 **Deterministic seeds:** Stable IDs and timestamps so UI doesn’t jitter.
- 🧪 **Demo student:** e.g., “Amelia K.” with light history in all three subjects.

---

## 14) Privacy, Safety, and Tone

- 🔐 **Privacy‑first:** Photos/PDFs are used **only** to create practice for that student; clearly explain where data lives.
- 👨‍🏫 **Teacher‑friendly:** We **augment** classwork; we **don’t replace** textbooks or share mark schemes broadly.
- 🗣️ **Tone:** Encouraging, brief, specific—“You improved on **Ions and charges**; try **Balancing equations** next.”

---

## 15) Implementation Checklist

- 🏁 **Home + One Button:** big “Scan or Upload”; Continue card; insight strip.
- 🧩 **Capture sheet:** crop/rotate; page type & board/topic chips; confirm.
- ⚙️ **Auto‑understand mock:** Q&A vs Summary; extract structure; map to topic.
- ▶️ **Practice generator:** 10± items; types per section 6; mark‑scheme mapping.
- 🎮 **Player scaffold:** consistent header; hint pill; feedback states; overflow menu.
- 📊 **Summary & next step:** grade band hint; top weak topic; “Practise now”.
- 🔭 **Progress lenses (one page):** Subjects • Timeline • Numbers + recommendations.
- 🧪 **Mocks/fixtures:** subjects, quizzes, metrics, and timeline seeded and stable.
- ♿ **Accessibility pass:** focus order, labels, contrast, keyboard flows.

---

## 16) Non‑Goals (for this phase)

- 🚫 No accounts/auth or backend integrations (prototype runs on mocks).
- 🚫 No heavy gamification (no streak pressure, loot boxes, or leaderboards).
- 🚫 No complex settings pages—defaults are sensible; edits happen inline.

---

## 17) What to Test with Students (5–10 users)

- 🔍 **Can they start in <10 seconds** from opening to first question?
- 🧭 **Do they understand the next step** without reading help text?
- 🧪 **Does feedback feel fair and useful** (esp. partial credit & sig figs)?
- 🎯 **Does the app feel aligned to their class/topic/board**?
- 🧘 **Is the experience calm** (not noisy) yet motivating?

---

### Appendix: Content Rules (Quick Reference)

- 📏 **Set length:** default 10± items or ~5–7 mins.
- 🎯 **Next step:** always one clear option; others tucked away.
- 🔁 **Re‑use the latest upload context** by default.
- 🧪 **Numeric items:** show **tolerance** and **units**; coach on significant figures.
- 🧠 **Free‑text:** short rubric and “model answer” comparison on reveal.
- 🧩 **Diagrams:** draggable labels; zoom/pan; instant check.
