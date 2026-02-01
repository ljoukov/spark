# CheckMate Chat UI Requirements

## Purpose
Define the functional and UI/UX requirements for the CheckMate in-app chat experience based on the provided screenshots and description. This document is the implementation target for the chat UI until superseded by `docs/SPEC.md` updates.

## Scope
- Implement the full-screen chat UI shown after login.
- Match the look/feel of the provided ChatGPT/Grok screenshots where feasible.
- Stream responses from the backend via Connect/protobuf.

## Target Platforms
- Mobile-first layout (iOS-like proportions and controls).
- Must render correctly on small screens and allow keyboard-driven interaction.

## High-Level User Flow
1. User logs in.
2. User is taken directly to a full-screen chat UI.
3. User composes a message in the input area at the bottom.
4. User submits the message.
5. Input clears immediately and a stop button appears (waiting state).
6. User message appears immediately in the conversation.
7. Server streams thinking text followed by the response text; response message appears with a copy button.

## UI Layout Requirements
### Main Surface (Chats + Chat View)
- Two full-screen pages: a chat list (left) and the active chat view (right).
- Horizontal drag between pages with snap-to-page behavior; the inactive pane dims during the transition (light + dark mode).
- Chat list includes a **New chat** button and shows each chat’s first line (truncated) plus the latest timestamp.
- Chat list data is loaded via `ListChats` over Connect/protobuf.
 - Chats with an in-flight response show a spinner indicator; status is driven by server timestamps.

### Screen Layout
- Full-screen chat view.
- Primary regions:
  - Header (existing app chrome if any).
  - Scrollable message list.
  - Input area pinned to the bottom.

### Message List
- Scrollable list that grows upward from the input area.
- Auto-scroll to the newest message on send and on response arrival.
- User messages and server responses are visually distinct and aligned like modern chat apps (ChatGPT/Grok style).
- Message spacing and typography should be calm, airy, and minimal.

### User Message (Outgoing)
- Appears immediately after send.
- Right-aligned bubble or capsule (ChatGPT-like).
- Light gray background or subtle tint.

### Server Message (Incoming)
- Appears as streamed text from the server.
- Left-aligned text (minimal bubble or no bubble) consistent with the screenshots.
- Under each server message, show a row of actions; for now only the **Copy** action is required.

### Thinking Message (Incoming)
- Streamed separately from the response and shown in its own visual container.
- Uses a distinct background that is darker in light mode.

### Copy Button (Response Action)
- Single button labeled "Copy" under each server message.
- Copies the full server message text to clipboard.
- No toast required, but it is acceptable to add a subtle confirmation if a pattern exists in the app.

## Input Area Requirements
### Default State (Empty)
- Single-line input with placeholder text: "Ask anything".
- Left of input: a circular "+" button that opens the attachment menu.
- Right of input:
  - Microphone or voice button (icon only) is acceptable when input is empty.
  - If app already uses a different icon, keep it consistent.

### Multi-line Growth
- Input grows vertically as the user types up to **8 visible lines**.
- After 8 visible lines, the input area becomes scrollable internally.
- No horizontal scroll; wrap text normally.

### Resize Button (Multi-line)
- When input has **more than 4 lines**, show a resize icon/button within the input area.
- Tapping it opens a **full-screen bottom sheet** dedicated to message editing.

### Full-Screen Bottom Sheet Input
- Covers most of the screen from the bottom (full-height or near full-height).
- Shows the full message content, allowing comfortable editing.
- Should preserve text formatting and line breaks.
- Closing the sheet returns to the main chat view with the text preserved in the main input.
- The sheet should provide a clear close/confirm affordance (existing app patterns apply).

### Send / Stop States
- When the user submits:
  - Input clears immediately.
  - A **Stop** button/icon appears in place of the send/mic icon on the right side of the input area.
  - User message is appended to the message list immediately.
- While waiting for the server response:
  - The Stop button remains visible.
  - Optional: a subtle typing indicator can be added later (not required now).
- When response arrives:
  - Stop button disappears, returning to the normal empty-input state.

## Attachment Menu (Plus Button)
- Tapping the "+" button opens a menu with three options:
  1. Camera
  2. Photos
  3. Files
- Menu style can be action sheet, bottom sheet, or popover per platform conventions.
- Selecting any option can be a no-op for now (placeholder action), but the selection should close the menu.

## Server Streaming Behavior
- Client sends the full conversation plus `conversation_id` to the server via Connect/protobuf.
- Server forwards the conversation to `gemini-flash-latest` and streams back:
  - `thinking_delta` chunks (rendered in the thinking container).
  - `response_delta` chunks (rendered as the main assistant response).
  - `status` updates with server timestamps (`streaming`, `idle`, or `error`).
- Stream ends with a `done` marker.
- The server persists the conversation to Firestore roughly every 10 seconds when the response changes, using `waitUntil()` so generation completes even if the client disconnects.
- The client streams live deltas via Connect and listens to Firestore for the canonical conversation history.

## Chat List API
- `ListChats(ListChatsRequestProto) -> ListChatsResponseProto` returns summaries for recent chats.
- Summary fields: `conversation_id`, `title`, `snippet`, `last_message_at`, `status`.

## Interaction Details
- Enter key submits if the platform supports it. For mobile, a send button is sufficient.
- Input should preserve line breaks when rendering user messages.
- Conversation should remain readable when the keyboard is visible (input area should move above keyboard).

## Non-Goals (for now)
- Rich attachments handling.
- Message reactions beyond the Copy action.

## Edge Cases
- Very long messages should be scrollable in the input and still render correctly in the message list.
- Fast consecutive sends should queue messages without UI glitches.
- If the user taps Stop, the pending response is cancelled and no server message is shown for that request.

## Acceptance Criteria
- After login, the user sees a two-page chat surface (chat list + chat view) with horizontal swipe + snap, and the inactive pane dims during the transition.
- Chat list includes a **New chat** button and shows each chat’s first line (truncated) plus the latest timestamp.
- After login, the user sees a full-screen chat UI with bottom input on the chat view page.
- Input grows up to 8 lines and then scrolls.
- Resize button appears after 4+ lines and opens a full-screen bottom sheet for editing.
- Plus menu offers Camera, Photos, Files.
- Sending a message clears input, shows Stop, and renders user message immediately.
- The server streams thinking + response text; the response includes a Copy button.
- UI visually resembles the provided ChatGPT/Grok screenshots for layout and spacing.
