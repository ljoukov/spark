# Lesson publishing schemas

`firestore-schema.json` contains JSON schemas for the documents that `publish_lesson` validates and writes to Firestore:

- `session` → `spark/{userId}/sessions/{sessionId}`
- `quiz` → `spark/{userId}/sessions/{sessionId}/quiz/{planItemId}`
- `code` → `spark/{userId}/sessions/{sessionId}/code/{planItemId}`
- `media` → `spark/{userId}/sessions/{sessionId}/media/{planItemId}`

Notes:

- The publisher always uses the `sessionId` passed to the tool (and preserves `createdAt` from the existing session stub).
- `session.plan[]` is authoritative for which quiz/problem/media documents must exist.
