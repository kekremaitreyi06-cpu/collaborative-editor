# CollabSpace — Real-Time Collaborative Document Editor

A portfolio/assignment starter project built with Node.js, Express, Socket.IO, JWT and a lightweight JSON-file store. Includes login/register, document CRUD, document sharing, live text updates, presence indicators, cursor position events, Docker support and a health endpoint.

## Requirements
- Node.js 22+ (Node.js 24 is also suitable)
- npm
- Docker Desktop (optional, for container run)

## Run locally
```bash
npm install
copy .env.example .env
npm start
```
Open http://localhost:3000.

For local development, `.env` can contain:
```env
PORT=3000
JWT_SECRET=use-a-long-random-secret-here
```

The app creates `data/store.json` automatically. This keeps the demo easy to run without requiring a database service. For a production deployment, replace the JSON-file store with MongoDB/PostgreSQL and replace last-write-wins text snapshots with a CRDT/OT engine such as Yjs.

## Use the app
1. Register an account with a name, email and password (8+ characters).
2. Create a document.
3. Open another browser/incognito window and register a second account.
4. To collaborate, first share the document with the second account's registered email.
5. The second user can then open the shared document and edit.
6. The app broadcasts text changes, online presence and cursor positions over Socket.IO.

## Docker
```bash
docker compose up --build
```
Open http://localhost:3000. The named volume `editor-data` preserves the app's JSON data across container recreation.

To stop:
```bash
docker compose down
```
To remove the volume too (deletes stored app data):
```bash
docker compose down -v
```

## API overview
- `GET /api/health`
- `POST /api/auth/register` — `{ "name": "...", "email": "...", "password": "at least 8 chars" }`
- `POST /api/auth/login` — `{ "email": "...", "password": "..." }`
- `GET /api/auth/me` — bearer token required
- `GET /api/documents` — bearer token required
- `POST /api/documents` — `{ "title": "..." }`
- `GET /api/documents/:id`
- `PATCH /api/documents/:id` — `{ "title": "..." }` and/or `{ "content": "..." }`
- `DELETE /api/documents/:id` — owner only
- `POST /api/documents/:id/share` — `{ "email": "registered-user@example.com" }`, owner only

## Notes / limitations
This is a learning/assignment project, not a hardened production editor. It uses a JSON file for persistence to keep setup fast. Simultaneous text edits use a last-write-wins snapshot strategy, which can overwrite overlapping edits. For robust concurrent editing, integrate Yjs/CRDT operations, add rate limits, structured logging, stronger secret management, and automated end-to-end tests before production use. The default JWT secret is for local development only; set `JWT_SECRET` to a strong secret before deployment.
