# Screenshot Flows

Use `scripts/web_screenshot_flow.py` to regenerate screenshots. Flows live under the relevant screenshot folder (for example `screenshots/quiz/free-text/flow.json`) so paths stay consistent.

## Prereqs

- Run the web dev server:
  - `cd web && npm run dev`
- Sign in using `/login-with-email` and the credentials from `web/.env.local` (`TEST_USER_EMAIL_ID_PASSWORD`).
- Ensure it is reachable at `http://127.0.0.1:8080`.

## Free-text grading (admin preview)

- Flow spec: `screenshots/quiz/free-text/flow.json`
- Output: `screenshots/quiz/free-text/01-wrong.jpg`, `02-incomplete.jpg`, `03-correct.jpg`
- Command:
  - `python3 scripts/web_screenshot_flow.py --spec screenshots/quiz/free-text/flow.json`

Notes:
- Screenshots must be `.jpg` with quality 90.
- The flow uses a tall viewport and full-page screenshots so grading feedback is not cut off.
- To watch the run, add `--headed` to the command (if a GUI is available).
