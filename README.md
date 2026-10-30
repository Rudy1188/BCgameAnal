# BCgameAnal

Tools for BC.Game Crash's provably-fair hashes: get the latest round's hash, salt and round ID, then calculate every earlier round's hash and crash point.

## Chrome extension (`extension/`)

**BC Crash Trend**: a panel inside the bc.game crash page with the trend balls and a stats table, updated every round.

### Install
1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick the `extension` folder (or click the reload icon if it is already installed).
3. Pin **BC Crash Trend** to the toolbar.

### Use
1. Open https://bc.game/game/crash (reload the tab after installing or updating the extension). The panel appears on the right side of the page.
2. Drag it by its title bar, drag its bottom-right corner to resize it, **–** to minimise, **×** to close. It remembers its place.
3. The toolbar icon shows or hides the panel (on another site it opens the crash page).
4. New results are read from the page's result strip as they appear. The round's hash is read from the page when available, or by clicking **Refresh** (which opens and closes bc.game's round box). The toolbar badge shows the latest result.

### Trend
- Styled like bc.game's own trend: a rounded square per round with a small dot inside, 30 columns × 10 rows on screen.
- **Red** 1.00× (instant crash), **orange** below the payout point, **green** at or above it, **yellow** 10× and up (counted on the green side).
- Each streak fills a column from top to bottom; a streak longer than 10 turns right along the bottom row (L-shape) instead of starting a new column. The next streak starts in the next column and stops above that tail.
- Scroll sideways (scrollbar or mouse wheel) through all the selected rounds, up to 100,000. The newest round is on the right, and the view follows new rounds unless you scrolled back.
- Hover a ball to see its round ID and crash point.

### Stats table
**Last [2000] issue, payout < [2]**, as on bc.game. Type any number of rounds from 10 to 100,000 and any payout point, or use the quick buttons. The trend uses the same rounds and payout point.

| Range | Chance | Count | Max Combo |
|---|---|---|---|
| [1, 2) | 49.00% | 980 | 12 |
| [2, ∞) | 51.00% | 1020 | 8 |

**Max Combo** is the longest run of rounds in a row in that range.

If the panel can't read the round, it says what it found on the page.

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
