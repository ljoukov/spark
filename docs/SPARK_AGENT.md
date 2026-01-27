# Spark AI Agent Requirements (Draft)

Status: draft
Scope: /home logged-in home layout and core AI experience

## Terminology

- Use the product term "Spark AI Agent" in UI and docs.
- Avoid "assistant" in user-facing copy.

## Home Layout (/home)

- The logged-in home is a single chat stream centered on Spark AI Agent.
- The stream is automatically organized into sections with a table of contents.
- Tasks appear as sections inside the same stream.
- Keep the visible scroll depth limited (target: ~5x screen height). Older content is pulled in as sections on demand.

## Core Capabilities

- Spark AI Agent can run multiple tasks in parallel (limit: 3 concurrent tasks per user).
- Example tasks include:
  - Creating lessons.
  - Planning multiple lessons.
  - Reviewing uploaded work interactively.

## Family System & Messaging

- Users can create a family via invite link.
- Family members have parent or dependent roles (permission model TBD).
- Default expectation: family members can message each other through Spark AI Agent so it can read, summarize, and act on messages.
- Messaging can also be sent verbatim to a specific member or a whole family channel; the UI treatment for this needs experimentation.
- Lesson progress visibility: generally available to all family members (role-based refinements TBD).
- Privacy: users must be able to opt out of AI reading family messages (behavior details TBD).

## Input, Voice, and Accessibility

- The Spark AI Agent input supports text plus attachments (images and PDFs).
- Voice mode supports both live audio and push-to-talk; transcripts are always visible.
- In voice mode, Spark AI Agent can still produce visual output.
- Visual outputs must have text descriptions so the voice experience can describe them when needed.

## Data & Realtime Sync

- Task statuses and chats are stored in Firestore.
- The UI relies on Firestore realtime updates, including updates across users.

## Open Questions / TBD

- Parent vs dependent permissions and visibility rules.
- Which actions Spark AI Agent is allowed to take from messages.
- Final UX for verbatim messaging vs AI-mediated messaging.
- Details of the AI opt-out experience and fallback behaviors.
