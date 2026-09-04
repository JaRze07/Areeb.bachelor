# Do You Know Hasina?

Static, host-run bachelor party game. No backend, no external services at party
time — HTML/CSS/JS plus one JSON file, served straight from GitHub Pages.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | All six screens (home, penalty setup, question, penalty reveal, questions editor, scoreboard) |
| `styles.css` | Dark, high-contrast, phone-first styling |
| `app.js` | Game flow, state, `localStorage` persistence, JSON export |
| `questions.json` | All 39 questions imported from the "Do you know Hasina?" doc |

## Game flow

1. **Next Question** → pick **Drink** or **Dare**, type what the penalty is.
2. **Reveal Question** → read it aloud to Areeb.
3. Tap **Show Hasina's answer** when you need it — it stays hidden until you do,
   so the phone can face the room.
4. Tap **Correct** or **Wrong**.
   - Correct → penalty discarded, round logged, back to home.
   - Wrong → the penalty fills the screen; tap **Done** once it's been served.
5. When the questions run out the scoreboard opens automatically.

Progress is written to `localStorage` after every step, so a mid-party refresh
resumes exactly where you left off.

## Questions & Answers screen

Every question is editable in the app — theme, question text, and Hasina's
answer. Edits save as you type. You can also **Add question** mid-party and
**Delete** ones you want to skip.

Five imported questions have no answer in the doc and are worth filling in
before you start: #12 (mother's surname), #15 (favourite spice), #16 (least
favourite juice), #34 (biggest pet peeve), #39 (primary school).

Edits live in `localStorage` on that one phone. **Download questions.json**
exports them so they can be committed back to the repo — otherwise they are not
shared with any other device. **Discard edits** reloads the committed file.

## Already played

Rounds 1–4 are hardcoded as seed state in `app.js` (`SEED_ROUNDS`) and referenced
by question id, so the queue never re-serves them:

| Round | Question | Penalty | Result |
| --- | --- | --- | --- |
| 1 | Best friend | dare — strip shirt and walk out of the restaurant | correct |
| 2 | Beach or mountains? | drink — 4 fingers of Corona beer | correct |
| 3 | Ferrari or Porsche? | drink — 4 fingers of Corona beer | wrong |
| 4 | Biggest pet peeve | drink — 5 fingers of Corona | wrong |

**Reset game** on the home screen wipes back to these four. It does not touch
your question edits.

## Scoreboard

Overall correct/wrong tally, a row-by-row table of every round (question,
Hasina's answer, penalty type, penalty description, result), an
All/Correct/Wrong filter, and a **Download results as JSON** button.

## Single-file build

`hasina-game-single-file.html` is the whole app — styles, code and all 39
questions — inlined into one file. It needs no server and no network: open it
straight from the phone, or upload just that one file to GitHub and point Pages
at it. Rebuild it after editing anything with:

```bash
python3 build-single-file.py
```

## Deploying to GitHub Pages

`.github/workflows/pages.yml` publishes the repo root on every push to `main`.
In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

GitHub Pages on a **private** repo needs a paid plan. On a free account, either
make the repo public before the party or run it locally:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly via `file://` will not work — the browser blocks
the `fetch` of `questions.json`. Use a local server or Pages.
