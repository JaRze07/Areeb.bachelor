# Bachelor Party "Guess the Bride's Answer" — Build Plan

## Concept
Single-page web app, hosted entirely on GitHub Pages, run by one host (phone/laptop) that walks through the game flow and tracks results for a final scoreboard. Everything — frontend, backend logic, and data — lives in one GitHub repo. No external services at runtime.

## Repo setup (do this first)
- Create a **private** GitHub repository under the account associated with **jacekrzepny3@gmail.com**.
- If not already authenticated, run `gh auth login` and log in as that account before creating/pushing the repo.
- Suggested repo name: `bachelor-party-game` (rename as you like).
- Deploy via GitHub Pages (`/docs` folder or a GitHub Actions build step) — repo can stay private; GitHub Pages supports private repos on paid plans, otherwise flip to public before the party or use a Pages-specific workaround (ask me if this matters).

## Questions data source
- I will share/paste the bride's Q&A content (from a Google Doc) directly in this chat.
- **Claude Code: if the Google Doc content hasn't been provided yet in this conversation, ask me for it before generating `questions.json` — don't invent placeholder questions.**
- Once provided, parse it into `questions.json` in the repo root, format:
```json
[
  { "id": 4, "question": "...", "brideAnswer": "..." },
  { "id": 5, "question": "...", "brideAnswer": "..." }
]
```
- Start numbering at `id: 4` — rounds 1–3 are already played (see seed results below).

## Game flow per round
1. Tap "Next Question" → app loads the next Q/A pair from `questions.json` (bride's answer shown only to host, never to groom).
2. Host picks penalty type for this round: **Drink** or **Dare** (chosen before the question is revealed).
3. Text field: host types what that specific drink/dare is (e.g. "4 fingers of Corona beer").
4. App reveals the question — host reads it aloud to the groom.
5. Groom answers out loud. Host taps **Correct** or **Wrong**.
   - Correct → penalty discarded, round logged as correct, move to next round.
   - Wrong → screen displays the recorded penalty prominently, host taps "Done" once completed.
6. Repeat until questions run out.
7. Scoreboard / Stats screen: full table of every round played — question text, bride's answer, penalty type, penalty description, and result (correct/wrong) — so you can see exactly which specific questions he got right vs. wrong, not just an overall tally. Include:
   - Overall tally (X correct / Y wrong) at the top
   - Full row-by-row table below, sortable/filterable by result if easy to add
   - "Download results as JSON" button

## Data model per round (runtime state)
```js
{
  id: number,
  question: string,
  brideAnswer: string,
  penaltyType: 'drink' | 'dare',
  penaltyDescription: string,
  result: 'correct' | 'wrong' | null,
  timestamp: string | null
}
```

## Seed results — already played, preload as completed rounds 1–3
```json
[
  {
    "id": 1,
    "question": "Bride's best friend",
    "penaltyType": "dare",
    "penaltyDescription": "Strip shirt and walk out of the restaurant",
    "result": "correct",
    "timestamp": null
  },
  {
    "id": 2,
    "question": "Mountain or beach",
    "penaltyType": "drink",
    "penaltyDescription": "4 fingers of Corona beer",
    "result": "correct",
    "timestamp": null
  },
  {
    "id": 3,
    "question": "Porsche or Ferrari",
    "penaltyType": "drink",
    "penaltyDescription": "4 fingers of Corona beer",
    "result": "wrong",
    "timestamp": null
  }
]
```
App should load these as initial state, then continue from round 4 onward using `questions.json`.

## Tech stack
- Plain HTML/CSS/JS single-page app (or single-file React build) — fully static, no backend server needed.
- All data (questions + seed results) stored as JSON files committed to the repo.
- Live game state held in memory + `localStorage` so a mid-party refresh doesn't wipe progress.
- Big, bold, mobile-friendly UI — this will be read off a phone in a loud room.

## Deployment
- GitHub Pages, deployed from the private repo under jacekrzepny3@gmail.com.
- Frontend, logic, and data all in one repo — nothing external to configure at party time.

## Stretch goals (optional, skip unless asked)
- Shuffle/skip question buttons, undo last round
- Fullscreen "reveal" mode for the penalty so the whole room can see it
- QR code linking to a spectator-only scoreboard view
- Sound effect on correct/wrong

## Claude Code task checklist
1. Set up private GitHub repo under jacekrzepny3@gmail.com (via `gh repo create`).
2. Scaffold static site (HTML/CSS/JS or single-file React).
3. Ask user for Google Doc question content if not already shared; build `questions.json`.
4. Hardcode the 3 seed results above as initial app state.
5. Implement full game flow described above.
6. Implement scoreboard + JSON export.
7. Set up GitHub Pages deployment.
8. Commit and push.
