# Chatbot

Streaming Grok chat app. Extracted from [ericzakariasson/grok-http](https://github.com/ericzakariasson/grok-http) `examples/chat`. Sample app for future Grok Voice skills. Not an official xAI app.

Uses `@xai/sdk` (`responses.create({ stream: true })`) from `github:ericzakariasson/grok-http`. Does not use Vercel AI SDK `useChat`.

## Run

Requires Node 22+.

```bash
cp .env.example .env.local
# set XAI_API_KEY in .env.local
npm install
npm run dev
```

Open http://localhost:3000.

The API key stays on the server (`POST /api/chat`). It is never sent to the browser.

## Verify

With `XAI_API_KEY` set, send a message. The assistant bubble should fill as `response.output_text.delta` events arrive. Stop cancels the in-flight request via `AbortController`. The next turn sends `input: [...prior.toInput(), { role: "user", content }]`.

Without a key the page still boots; `/api/chat` returns an error.

```bash
npm test
```

That test mocks the stream mapping. It does not call api.x.ai.

## Notes

- Model: `grok-4.6` (`models.Grok46`). `store` stays at the SDK default (`false`).
- Default theme is light. The header toggle persists `light` / `dark` in `localStorage` (`grok-chat-theme`) and falls back to the system preference when unset.
- shadcn components are vendored (`message-scroller`, `message`, `bubble`, `marker`, `attachment`) plus nova styles so the app does not depend on ui.shadcn.com at runtime.
