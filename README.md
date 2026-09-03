# Chatbot

Chatbot webapp.

Requires Node 22+.

```bash
cp .env.example .env.local
# set XAI_API_KEY in .env.local
npm install
npm run dev
```

Open http://localhost:3000.

The API key stays on the server (`POST /api/chat`). It is never sent to the browser.

```bash
npm test
```

That test mocks the stream.
