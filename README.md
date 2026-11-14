# Roomscape

**Your room is the escape room.** Photograph the four walls of any real room. AI turns the things you actually own into a chain of puzzles, a solver proves the room can be escaped, and your friends race to get out through a shared link.

Built for IceHacks 2026.

- Live app: _add the URL after deploying_
- Demo video: _add the link_

## How it works

1. **Photograph four walls.** Photos are shrunk and re-encoded in the browser, which removes location data, before they are sent anywhere.
2. **The AI reads the room.** A vision model lists objects with bounding boxes, plus facts it can count or read: "9 books on the shelf", "the poster says ORION", "the stripes run red, white, blue".
3. **You are the director.** Vision models miscount. The creator drags boxes, fixes values, ticks each fact as checked, and marks private areas to blur. Only confirmed facts are ever used.
4. **The AI proposes, the solver decides.** The model designs a puzzle chain and writes the story. Code then builds the game, and a solver checks it. A rejected design goes back to the model with the solver's complaints. If the model keeps failing, a chain built by plain code is used, so the creator always gets a playable room.
5. **Share and race.** Publishing uploads the photos (with marked areas pixelated on the device first) and gives a link. Players escape in the browser and post their time to the room's leaderboard.

## Why it can be trusted

The model is never trusted with anything that would break the game.

| Risk | What stops it |
|---|---|
| The AI miscounts or misreads | The creator confirms every fact on the director screen. Unconfirmed facts are refused. |
| The AI invents an answer | Lock answers are copied by code from confirmed facts. The model only chooses which fact a puzzle uses. |
| The room cannot be finished | The solver runs a fixed-point search over (items held, puzzles solved) and rejects rooms where the exit is unreachable. |
| A puzzle can be skipped | Each puzzle is removed in turn; if the exit still opens, the room is rejected. |
| A clue gives the answer away | Clues containing the answer are replaced with a neutral one. |
| Answers visible in the page | Answers are sent as salted SHA-256 hashes. The explicit hint is fetched from the server only when asked for. |
| The AI is down or out of quota | Several models are tried, in a hedged race. Puzzle design falls back to a code-built chain. |

The solver also checks that every item is handed out once and used, that no two puzzles rest on the same fact, and that no object hosts two puzzles. It runs again every time a room is loaded.

## Architecture

```
src/
  app/
    page.tsx                      home: how it works, rooms to play
    create/                       upload -> scan -> director -> build -> publish
    play/[id]/                    loads a room, re-verifies it, seals answers, renders the engine
    api/analyze                   4 photos -> objects, facts, sensitive areas (streamed progress)
    api/generate                  reviewed room -> verified game (streamed progress)
    api/rooms/[id]/publish        stores photos, makes the room playable by link
    api/rooms/[id]/hint/[puzzle]  the explicit hint, server-side
    api/rooms/[id]/runs           leaderboard
  components/
    GameEngine.tsx, LockModal.tsx, Leaderboard.tsx
    create/                       UploadStep, Director, CreateFlow
  lib/
    ai/gemini.ts                  the only file that knows the AI provider
    analysis/                     vision prompt, schema, cleanup of the model's reply
    generate/plan.ts              proposal -> game, plus the code-built fallback chain
    generate/prompt.ts            design brief for the model
    game/schema.ts                the Game JSON contract (Zod)
    game/solver.ts                solvability and necessity checks
    game/seal.ts                  answer hashing
    store/                        Supabase in production, files in .data/ for local development
    image.ts                      client-side resize, metadata removal, pixelation
```

Five puzzle templates: number lock from counted objects, colour lock from a colour order, word lock from text in the photo, hidden item, and use an item.

## Run it locally

Requires Node 22.18 or newer.

```bash
npm install
cp .env.example .env.local   # then add your GEMINI_API_KEY
npm run dev
```

Open http://localhost:3000. Without Supabase keys, rooms are stored in `.data/`.

```bash
npm test        # solver and planner tests
npm run lint
npm run build
```

### Deploying

1. Create a Supabase project and run `supabase/schema.sql` in its SQL editor.
2. Set `GEMINI_API_KEY`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the host's environment.
3. Optionally set `FEATURED_ROOMS` to a comma-separated list of published room ids to show on the home page.

## Privacy

- Photos are resized and stripped of metadata in the browser before upload.
- Scanning sends the four photos to Google's Gemini API. On the free tier, Google may use submitted content to improve its products, so the upload screen says so.
- Nothing is stored until the creator presses Publish. Areas marked for blurring are pixelated on the device before the photos are uploaded.
- Published photos are readable by anyone who has the room link.

## Known limits

- The leaderboard trusts the time reported by the player's browser. It is a friendly board, not a tamper-proof one.
- Lock answers are hashed, but a short code can be guessed by trying every combination.
- Rate limiting is in memory per server instance.
- The Gemini free tier allows a small number of requests per day per model, so room creation can be temporarily unavailable. The rooms on the home page always work.

## Built with

Next.js 16, React 19, TypeScript, Tailwind CSS 4, Zod, Google Gemini API, Supabase (Postgres and Storage).

## AI disclosure

- **In the product:** Google Gemini models read the photos and propose puzzle designs and story text.
- **In development:** Claude Code (Anthropic) was used as a coding assistant to write and test the code.
