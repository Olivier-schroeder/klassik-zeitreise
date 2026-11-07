# Klassik-Zeitreise

A homemade classical-music timeline card game: scan a card, hear a piece (via Spotify,
title hidden), place it in your timeline by year. The back of the card shows the answer.

No app to install: it's a web page that works on any phone with a browser.

## Files

| File | What it is |
|---|---|
| `index.html`, `app.js` | The game: built-in QR scanner, big play button, nothing gives the piece away |
| `prepare.html` | For you: choose the Spotify recording and start time for each card, export `cards.json` |
| `print.html` | Printable A4 sheets (3 x 4 cards), fronts with QR codes, mirrored backs with the answers |
| `cards.json` | The card list (id, composer, title, year, Spotify track, start time) |
| `config.js` | The only settings: Spotify Client ID and the public address |
| `common.js`, `scanner.js`, `style.css` | Shared code and styles |

See "The piece list" below for the year rule.

## Setup (once)

### 1. Put it online (GitHub Pages, free)

1. Create a GitHub repository, e.g. `klassik-zeitreise`, and push this folder to it.
2. On GitHub: Settings -> Pages -> "Deploy from a branch", branch `main`, folder `/ (root)`.
3. After a minute the game is at `https://<your-github-name>.github.io/klassik-zeitreise/`.

Phones need `https` for the camera and the Spotify login, so testing on a phone only works
from this address (on the computer, `http://127.0.0.1:8765/` works too, see below).

### 2. Create the Spotify app (about 10 minutes)

1. Log in at https://developer.spotify.com/dashboard and click "Create app".
2. Name and description: anything, e.g. "Klassik-Zeitreise".
3. Redirect URIs, add both:
   - `https://<your-github-name>.github.io/klassik-zeitreise/`
   - `http://127.0.0.1:8765/` (for testing on your computer)
4. API: tick "Web API". Save.
5. Copy the **Client ID** into `config.js` (`SPOTIFY_CLIENT_ID`). It is not a secret.
6. Set `BASE_URL` in `config.js` to the GitHub Pages address from step 1.
7. App settings -> "User Management": add the name and Spotify email of **every family member
   whose phone will play**. The app stays in "development mode", which only lets these
   accounts log in (currently up to about 25). Every account needs Spotify Premium.

### 3. Choose recordings and start times

Open `prepare.html`, connect Spotify, and for each card: search, listen ("▶ ab Start"), pick
a recording, set the start (type m:ss, or play in Spotify and press "Aktuelle Position
übernehmen"). Then "cards.json herunterladen" and replace `cards.json` in this folder.
Cards without a chosen recording play the first search result, so a quick check is worth it.

### 4. Print

Open `print.html`, print double-sided ("flip on long edge"), scale 100 %. Check that the
yellow warning is gone (it means `BASE_URL` is still a local address). For proper card stock,
save as PDF and send it to a card printer.

## Playing

1. Open the game address on the phone (bookmark it, or "Add to Home Screen").
2. First time on each phone: "Mit Spotify verbinden" and log in.
3. Open the Spotify app once and start/pause any song, so the phone counts as an active
   Spotify device. The game then controls it.
4. "Karte scannen" -> point the camera at a card -> music plays. Keep the game page open and
   don't swipe down the notification bar: the Spotify notification shows the title.

Scanning with the normal camera app also works (it opens the game page with that card).

## The piece list

The pieces live in `data/*.tsv` (one file per era, tab-separated: id, composer, title, year,
note, check, optional Spotify search text). Edit them in any editor or in Excel, then run

    python tools/build_cards.py

It gives new rows an id, checks years and duplicates, keeps the Spotify choices already in
`cards.json`, and rebuilds `cards.json`. Rows with `1` in the check column are marked
"Jahr prüfen" on `prepare.html`: look the year up, fix it if needed, delete the `1`.

Year rule on the cards: the year the work was completed; for operas, ballets and stage music
the first performance (`UA`); if only the first printing is known, its year (`Druck`).

Never reuse or change the id of a printed card: the QR code contains only the id, so you can
change the recording, start time or even the year later without reprinting the front.

## Rules

`rules.html`: rules in German and English plus a setup sheet, 3 A4 pages (print or save as PDF).

Optional: `"audio": "<url of an mp3>"` on a card plays that file in the browser when the
phone is not connected to Spotify (e.g. guests).

## Test on the computer

Any static web server in this folder on port 8765, e.g.:

    python -m http.server 8765 --bind 127.0.0.1

then open http://127.0.0.1:8765/ (use `127.0.0.1`, not `localhost`: Spotify only accepts
that form for local redirect addresses).

## Spotify search terms and start hints

`data/spotify_*.tsv` holds, per card id: English search terms (several alternatives separated
by ` | `), an optional start time (m:ss) and an optional hint for the person choosing the
recording (e.g. "the famous theme only comes after ~1:40"). `tools/build_cards.py` merges
them into `cards.json`; a start time chosen by hand on `prepare.html` always wins.

On `prepare.html`, "Automatisch auswählen" searches every card without a recording, scores
the hits (composer as artist, matching title words and catalogue numbers; arrangements,
lofi/relax compilations and very short tracks lose points) and keeps the best one with a
score: sicher (>= 85 %), mittel, unsicher (< 65 %). Then tick "nur unsichere Auswahl",
listen, fix or confirm ("Passt ✓"), and download `cards.json`. Without a chosen recording
the game uses the same scoring at play time.

The game page has a "⏩ 30 s" button for pieces with a quiet beginning.
