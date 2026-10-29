# BCgameAnal

Tools for BC.Game Crash's provably-fair hashes: get the latest round's hash, salt and round ID, then calculate every earlier round's hash and crash point.

## Chrome extension (`extension/`)

Runs in your own browser on `bc.game`, picks up the latest Crash round, and shows it in a popup with the earlier rounds.

### Install
1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick the `extension` folder.
3. Pin **BC Crash Hash** to the toolbar.

### Use
1. Open https://bc.game/game/crash (reload the tab after installing or updating the extension).
2. Click the extension icon. Every time the popup opens, it fetches the newest round from the bc.game tab: it opens the newest result in the page's result strip, reads its **Round ID / Salt / Hash** box, and closes it.
3. New rounds are also picked up on their own, whenever a round's details box is open or the page's data contains a hash that chains back to the saved one (SHA-256).
4. The popup shows the latest round, a **Trend** panel and an **Analysis** panel (up to 50,000 rounds). The icon badge shows the latest crash point.
5. **Open full history** opens a tab for long-range work: up to **5,000,000 rounds** (1M takes about 6–10 s, calculated in the background), trend, analysis, an overview of every payout point, and a paged table with find-by-round and CSV.

All panels default to the last **2,000** rounds.

### Analysis panel
Pick how many rounds and a payout point (1.3×, 1.5×, 2×, 3×, 5×, 10×, … or type any value). It shows, like bc.game's own stats table:

| Range | Chance | Count | Max Combo | Current |
|---|---|---|---|---|
| [1, 2) | 48.20% | 964 | 9 | 0 |
| [2, ∞) | 51.80% | 1036 | 11 | 1 |

**Max Combo** is the longest run of rounds in a row in that range; **Current** is the run going on right now.

### Trend panel
Uses the same rounds and payout point as the analysis panel.
- **Beads**: a dot per round, red below the payout point and green at or above it, one column per streak (long streaks continue in the next column).
- **Chart**: multiplier bars on a log scale, a dashed line at the payout point, and a blue line for the share of rounds at or above it. Choose how many rounds fit on screen (100 to 1,000,000).
- Drag the slider left to go back through history; hover a dot or bar to see its round.

If the popup can't read the bc.game tab, it shows what it found on the page (useful for fixing it), and you can still enter a round by hand.

### Statistical report & trust score
**Statistical report** (popup, or the link on the full-history page) analyses up to 5,000,000 rounds (default 1,000,000, from the latest back) and reports:

- **Hit rates** for targets 1.0×–2.0× (step 0.1×): successes, rounds, hit/fail rate, 95% Wilson interval and its half-width.
- **Expected return**: EV = x·p̂ − 1 and ROI with confidence intervals (assumes a win pays the target in total, stake included).
- **Baseline comparison** against a configurable house edge, p(x) = (1 − edge)/x. With bc.game's formula this is exact for two-decimal targets.
- **Rolling windows** of 10,000 rounds: non-overlapping windows for tests (mean, SD vs expected SD, min/max, trend, homogeneity χ², Bonferroni-flagged windows), and overlapping steps for charts.
- **Dependence**: autocorrelation and Ljung–Box (lags 1–20), Wald–Wolfowitz runs, longest streaks vs expectation, CUSUM change points.
- **Distribution**: χ² fit to the baseline, first vs second half, and 10-segment comparisons.
- **Multiple testing**: Holm correction within each test group and across all tests. Only results that survive the correction across all tests count as significant.
- **Trust score (0–10)**: how consistent the history is with a fair game with independent rounds. It is not a betting signal.
- Export to JSON or CSV.

Checked on simulated data: fair data scores 10/10 at 1,000,000 rounds. A hidden 3% edge, rounds that depend on the previous one, and a slow drift are each caught by the matching tests. On 1,000,000 real rounds (8745448–9745447) the score is 9.9/10, with no significant deviations.

**These are historical measurements only.** If rounds are provably fair and independent, past results cannot predict the next round, and every target's expected return is about −1%.

## Node calculator (`src/`, `public/`)

```
npm install
npm run build
npm start                                   # web page at http://127.0.0.1:3000
npm run calc -- <hash> [count] [roundId]   # command line
npm run report -- <hash> [rounds] [roundId] [--edge=0.01] [--json=out.json]   # statistical report
```

## Formula

- **Previous round's hash** = SHA-256 of the current hash (as hex text).
- **Crash point**: HMAC-SHA256 with the salt as key and the hash bytes as message. Take the first 52 bits as `X / 2^52`, round to 9 significant digits, then `crash = floor(99 / (1 - X)) / 100`, minimum 1.00×.

Example: round 9745447, hash `0ab60395…0b7e`, salt `0000…e2f9` → **8.17×**.

The chain only runs backwards: a hash gives you every earlier round, not the next one.
