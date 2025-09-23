## 1) Product vision & scope

**Vision.** A phone‑first trainer that feels like the real state exam: the **same item types**, **the same blueprints**, and **the same scoring logic** (including partial credit where states publish it). Web app exists for classrooms and authoring, but the primary experience is on iOS/Android (PWA acceptable on Android initially).

**In scope (phase 1).**

- **Biology** for TX, FL, VA, NY, CA (closest to UK Y10–Y11 / triple‑science entry point).
- “Exam Mode” (full simulation) and “Practice Mode” (skill/standard focused).
- Item types and scoring that match each state’s published specs.

**Out of scope (phase 1).**

- ELA, social studies, and math.
- Teacher LMS integrations (nice‑to‑have later).
- Admissions/college prep (AP/IB/SAT).

**Why this slice.** All U.S. states **must** test science at least once in middle school and once in high school under federal law; states then add their own course EOCs (e.g., Biology) or integrated NGSS tests. That guarantees universal demand and stable public specifications to align to. ([U.S. Department of Education][1])

---

## 2) Target exams (fidelity anchors)

1. **Texas STAAR Biology (EOC, graduation‑bearing)**

   - **Constraint:** ≤ **75%** of points may be multiple‑choice; remaining points are **technology‑enhanced** (TEIs) and short constructed response. Build rich TEIs. ([Texas Education Agency][2])

2. **Florida Biology 1 (EOC, course‑required)**

   - **Format:** **All multiple‑choice**, computer‑based; published time and item‑count ranges. This is the easiest to simulate with perfect fidelity. ([Florida Department of Education][3])

3. **Virginia SOL Biology (EOC)**

   - **Format:** Mix of MC + **TEIs** (drag‑and‑drop, hot spot, numeric fill‑in/graphing) delivered in **TestNav**. Build those interactions and practice tools. ([Virginia Department of Education][4])

4. **New York Regents (Living Environment; later Chem/Physics)**

   - **Format:** MC + **constructed response**; in Chem/Physics **method is scored** (equation, substitution **with units**, final answer). Provide “show‑your‑work” capture and partial‑credit rubrics. ([NYSED Regents][5])

5. **California CAST (NGSS, grade 8 and one HS test)**

   - **Format:** Computer‑based **performance tasks** (multi‑step around a phenomenon), plus discrete items; public blueprints and item‑specs. Implement a performance‑task runner with hand‑scored short responses. ([CAASPP & ELPAC][6])

---

## 3) Personas & core jobs‑to‑be‑done

- **Student (primary)** — “Give me practice that looks and feels like the real thing, tells me exactly what I got wrong, and how to improve before test day.”
- **Parent** — “I want a trustworthy, state‑aligned tool that uses official criteria.”
- **Teacher/School (phase 1.5)** — “Assign state‑standard practice and see progress against blueprints.”

---

## 4) User journeys

**Onboarding (≤60 sec).**

- Choose **State → Course/Test** (e.g., TX → Biology EOC; CA → CAST HS).
- Pick **practice goal** (skills vs. exam), **test date**, and **daily streak target** (5–15 mins).

**Practice Mode.**

- Select **standard(s)** or **blueprint category**; get a short set (5–12) with spacing/retry.
- Immediate feedback; targeted hint/exemplar; micro‑review cards generated from misses.

**Exam Mode.**

- Full simulation with **state‑accurate item types**, **weights**, **tools**, and **timing** (when published). Summary shows **blueprint coverage** and “likely band/threshold” where states publish conversion guidance (label as **estimates**, not official).

---

## 5) Content & alignment layer

**Standards model.**

```json
{
  "jurisdiction": "TX",
  "test": "STAAR_Biology_EOC",
  "version": "2025.1",
  "blueprint": [
    { "id": "RC1", "name": "Cell Structure & Function", "weight": 0.22 },
    { "id": "RC2", "name": "Genetics & Evolution", "weight": 0.28 },
    { "id": "RC3", "name": "Biological Processes", "weight": 0.3 },
    { "id": "RC4", "name": "Ecology", "weight": 0.2 }
  ],
  "standards": [
    { "id": "BIO.6A", "text": "...", "rc": "RC3" },
    { "id": "BIO.7C", "text": "...", "rc": "RC2" }
  ],
  "item_types_allowed": [
    "MC",
    "MS",
    "Inline",
    "DragDrop",
    "HotSpot",
    "Numeric",
    "SCR"
  ]
}
```

- **Version** ties to a dated **“audit pack”** (PDF blueprint/specs with URL + hash) for **TX/FL/VA/NY/CA**, kept in `/docs/alignment/US/`. This is your evidence for “aligned to the latest published specifications.” ([Texas Education Agency][2])

**Item metadata.**

- `tags`: \[`state`, `test`, `blueprint_rc`, `standard_id`, `demand_level`, `item_type`, `calc_allowed`, `units_required`, `stimulus_id`].
- **Difficulty** calibrated from pilot data; **demand** keyed to NGSS practices (evidence use/modeling) where relevant to CAST. ([California Department of Education][7])

**Coverage targets (phase 1).**

- **TX Biology EOC**: 600 items (≥40% non‑MC TEIs/SCR).
- **FL Biology 1**: 400 items (all MC). ([Florida Department of Education][3])
- **VA Biology SOL**: 450 items (≥30% TEI). ([Virginia Department of Education][4])
- **NY Living Environment**: 450 items (MC + short answer). **Add 150 Chem/Physics “show‑work” items** for phase 1.5. ([NYSED Regents][5])
- **CA CAST (MS/HS)**: 12–16 **performance tasks** + 300 discrete items. ([CAASPP & ELPAC][6])

_(Counts are product targets to ensure healthy blueprint coverage; they’re not from the states.)_

---

## 6) Item types & interaction engine (must‑have widgets)

**Universal**

- **Single‑select MC**, **multi‑select**, **inline choice**.
- **Stimulus sets** (tables, charts, images) with multi‑part follow‑ups.
- **Timer**, **review/flag**, **strike‑through**, **basic highlighter**.

**TEI library (match states)**

- **Drag‑and‑drop**, **hot spot (image map)**, **match‑table grid**, **numeric entry (+ unit picker)**, **graphing/plotting** (points/lines). Required for **TX** and **VA**. ([Texas Education Agency][2])

**Constructed response**

- **Short Constructed Response (1–2 pts)** with **state‑style rubric** (TX Biology; CA CAST PTs). Editor supports: expected ideas, vocabulary, misconception flags, sample anchors. ([Texas Education Agency][2])

**“Show‑your‑work” mode (NY Regents Chem/Physics)**

- Step capture UI: **equation** → **substitution with units** → **numerical answer**; **partial‑credit** rules. Auto‑checks units/sig figs; rubric allows teacher override. ([NYSED Regents][5])

**Performance task runner (CAST)**

- Scenario → data exploration → multi‑part items → one **hand‑scored** 2‑pt response per task. Lightweight scorer with rubric & exemplars. ([California Department of Education][8])

---

## 7) Scoring & feedback

- **Auto‑scored** for MC/TEIs; **rules‑based** for numeric with tolerance + unit checks.
- **Rubric engine** for SCR/CAST PTs/NY method credit; supports **anchor exemplars**, **rationale**, and **coaching tips**.
- **Blueprint‑aware scores**: show **reporting category** strengths/weaknesses; keep **scaled‑score** only where states publish transparent conversions (e.g., Regents reports). Otherwise display **raw + category bands** with clear “unofficial estimate” labeling. ([NYSED Regents][5])

---

## 8) Mobile UX requirements

- **Phone‑optimized** TEIs (thumb‑reach, 44px min targets, haptic cues on drops).
- **Low‑friction session starts** (<3 taps from home to practice).
- **Offline cache** for assigned sets & media; **sync on reconnect**.
- **Accessibility**: WCAG 2.2 AA; ARIA for all TEIs; captions/alt text; color‑contrast; **keyboard nav** on web.
- **Accommodations**: extended time, enlarged UI, reduced motion; **calculator tool** toggled per test policy (NY Physics allows; configure per test). ([NYSED Regents][5])

---

## 9) Content authoring & QA

- **Authoring templates** per item type with **validators** (e.g., distractor count, unit consistency, alt text required).
- **Blueprint quota views**: show item counts vs. target weights.
- **Spec‑driven lint**: blocks publish if tags (state/test/standard) missing.
- **Golden sets**: include a few **released or released‑style** items per state for continuous calibration/QC (do not republish copyrighted stems; link for internal comparison).

  - **Virginia**: use VDOE practice & released item sets to sanity‑check TEI fidelity. ([Virginia Department of Education][4])
  - **Florida**: adhere to item‑spec response/stimulus attributes; confirm **all MC**. ([Florida Department of Education][3])
  - **Texas**: ensure <75% of points MC across practice tests. ([Texas Education Agency][2])
  - **California**: include at least one hand‑scored CR per CAST performance task. ([California Department of Education][8])
  - **New York**: verify method‑credit logic against **latest** Physics/Chem rating guides. ([NYSED Regents][5])

---

## 10) Evidence & compliance

- **Audit packs**: for each state/test, store **PDFs/URLs + SHA‑256** of:

  - Latest **blueprint**, **item specs**, **rating/score guides**, **policy memos**.

- **Changelog**: surface “Aligned as of **YYYY‑MM‑DD**” in About → Test Info.
- **Privacy**: COPPA for under‑13 users (consent flows), FERPA for school pilots, data minimization & parental controls (delete request path).
- **Test integrity**: randomized variants; **no scraping** of secure items; honor public‑domain or licensed resources only.

---

## 11) Data & analytics (student‑visible and ops)

**Student dashboards**

- **Mastery by blueprint category** (“Cell Biology 67% → aim 80%”).
- **Most‑missed skills** with 3‑day spaced practice plan.
- Pace vs. **test date**; daily streaks & gentle nudges.

**Ops dashboards**

- Item performance (p‑value, point‑biserial), TEI error heatmaps.
- **Drift alerts** when blueprint proportions in live exams change (manual input) or when a state posts updated specs.

---

## 12) Tech stack & architecture (building on your repo)

- **Clients**:

  - **iOS (SwiftUI)**: native TEI components; **WKWebView** fallback for complex graphing if needed.
  - **Web (SvelteKit)**: same TEI schema; reuse rendering logic via shared **protobuf/JSON contracts** (already in your `proto/`).

- **Backend**: **Firestore** (items, sessions, telemetry), **Cloud Storage** (media), **Edge functions** for scoring, generation, and rubric evaluation (already fits your `event.waitUntil` model).
- **Content pipeline**: import state specs → generate skeleton **alignment records**; author in **web**; publish via signed releases with version pinning.
- **Testing**: device farms for drag‑and‑drop/gesture correctness; golden snapshots for every TEI type.

---

## 13) Success metrics & quality bars

- **Activation:** 70% of new students complete ≥1 practice set day‑1.
- **Fidelity:** ≥95% of items validate against the **TEI/unit/rubric** checks; **Exam Mode** matches state blueprint weights ±2%.
- **Learning:** median **+15 percentage‑point** gain from first to third attempt on a blueprint category.
- **Delight:** CSAT ≥4.5/5 on “feels like the real test.”

---

## 14) Rollout plan (90–180 days)

**Phase 1 (TX + FL + VA + NY Bio; CA CAST HS & Grade 8)**

- Ship core TEIs, SCR/rubric engine, NY method scoring, CAST PT runner.
- Publish **audit packs** and “Aligned as of” banners in‑app.
- Pilot with 3–5 schools per state; A/B test exam‑mode UX.

**Phase 1.5 (Chem/Physics)**

- Add **NY Chem/Physics** (method scoring), **VA Chemistry/Physics**, **TX Chem/Phys items for practice only** (no EOC but demand exists).
- Expand CAST tasks.

**Phase 2**

- Add more NGSS states that mirror CAST‑style integration.

---

## 15) Risks & mitigations

- **Spec changes** mid‑year → Mitigate with audit packs + versioned content; show “aligned as of” date.
- **TEI UX on small screens** → Minimum target sizes; haptics; “precision mode” toggle; aggressive device testing.
- **Scoring trust** → Public rubric references and exemplars; clear labels where scores are estimates vs. official.

---

### Appendix: Key authorities we align to (for PMs, Content, QA)

- **Federal requirement** for science testing in three grade spans; states choose formats. ([U.S. Department of Education][1])
- **CA CAST** uses **computer‑based items + performance tasks** and publishes **blueprints/specs**. ([CAASPP & ELPAC][6])
- **TX STAAR (HB 3906)** imposes **≤75% MC** and adds non‑MC item types. ([Texas Education Agency][2])
- **FL Biology 1** EOC items are **all multiple‑choice** (latest item‑specs). ([Florida Department of Education][3])
- **VA SOL** provides **TEI practice/released items** in TestNav. ([Virginia Department of Education][4])
- **NY Regents** rating guides **award partial credit** for correct method (equation, substitution **with units**, answer). ([NYSED Regents][5])

[1]: https://www.ed.gov/laws-and-policy/laws-preschool-grade-12-education/esea/what-is-the-every-student-succeeds-act "What is the Every Student Succeeds Act?"
[2]: https://tea.texas.gov/student-assessment/assessment-initiatives/staar-redesign "STAAR Redesign"
[3]: https://www.fldoe.org/core/fileparse.php/5662/urlt/SCIBIO1EOCTSI.pdf "Biology 1 End-of-Course Assessment Test Item ..."
[4]: https://www.doe.virginia.gov/teaching-learning-assessment/student-assessment/sol-practice-items-all-subjects "SOL Practice Items (All Subjects)"
[5]: https://www.nysedregents.org/physics/623/phys62023-rg.pdf "Rating Guide"
[6]: https://www.caaspp-elpac.org/assessments/caaspp/cast "California Science Test"
[7]: https://www.cde.ca.gov/ta/tg/ca/documents/castblueprint.pdf "California Science Test Blueprint"
[8]: https://www.cde.ca.gov/ta/tg/ca/caasppscience.asp "California Science Test"
