# BCgameAnal

Tools for BC.Game Crash's provably-fair hashes: get the latest round's hash, salt and round ID, then calculate every earlier round's hash and crash point.

## Chrome extension (`extension/`)

**BC Crash Trend**: a small window that stays open next to bc.game and shows the Crash trend balls, a stats table and the biggest crashes, updated every round.

### Install
1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick the `extension` folder (or click the reload icon if it is already installed).
3. Pin **BC Crash Trend** to the toolbar.

### Use
1. Open https://bc.game/game/crash (reload the tab after installing or updating the extension).
2. Click the extension icon. A small window opens (400 × 720, resizable; it remembers where you put it). It stays open while you play; clicking the icon again brings it to the front.
3. The window reads the newest round from the bc.game tab when it opens (or click **Refresh**), then adds each new result from the page's result strip as it appears. These rounds are confirmed by the hash chain when the next hash is read. The toolbar badge shows the latest result.

### Stats table
**Last [2000] issue, payout < [2]**, as on bc.game. Type any number of rounds from 10 to 100,000 and any payout point, or use the quick buttons (100 / 500 / 2K / 10K / 100K, 1.5× / 2× / 3× / 5× / 10×).

| Range | Chance | Count | Max Combo |
|---|---|---|---|
| [1, 2) | 49.00% | 980 | 12 |
| [2, ∞) | 51.00% | 1020 | 8 |

**Max Combo** is the longest run of rounds in a row in that range.

### Trend balls
- **Red** below the payout point, **green** at or above it, **yellow** 10× and up (counted on the green side).
- Each streak fills a column of 6 from top to bottom. A streak longer than 6 turns right along the bottom row (L-shape) instead of starting a new column; the next streak starts in the next column and stops above that tail.
- **Pages** fit the window width. The last page is the newest; use « ‹ › » or type a page number. All of the selected rounds (up to 100,000) can be paged through.
- Hover a ball to see its round ID and crash point.

### Biggest crash
The highest crash point in the selected rounds, with its round ID and how many rounds ago, plus the next 9 biggest (bar length on a log scale). Click any of them to jump to its ball in the trend (ringed in blue). The biggest ball always has a white ring.

### History
Every selected round as round ID + crash point, newest first, 60 per page.

If the window can't read the bc.game tab, it says what it found on the page, and you can still enter a round by hand.

**Past results don't predict the next round.** Over 1,000,000 real rounds every payout point returns about −1%, and no betting rule tested beat chance.

## Node calculator (`src/`, `public/`)

```
npm install
npm run build
npm start                                   # web page at http://127.0.0.1:3000
npm run calc -- <hash> [count] [roundId]   # command line
npm run report -- <hash> [rounds] [roundId] [--edge=0.01] [--detail] [--json=out.json]   # statistical report
```

## Formula

- **Previous round's hash** = SHA-256 of the current hash (as hex text).
- **Crash point**: HMAC-SHA256 with the salt as key and the hash bytes as message. Take the first 52 bits as `X / 2^52`, round to 9 significant digits, then `crash = floor(99 / (1 - X)) / 100`, minimum 1.00×.

Example: round 9745447, hash `0ab60395…0b7e`, salt `0000…e2f9` → **8.17×**.

The chain only runs backwards: a hash gives you every earlier round, not the next one.
