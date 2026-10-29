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

### Strategy tester & next-round pick
**Strategy tester** (popup) replays a betting rule over the last 1,000,000 rounds (100,000 / 500,000 selectable). Each decision uses only the rounds before the one bet on. It then shows the rule's **pick for the next round**, updated every round while the bc.game crash tab is open.

- **Points:** 28 — exact **1.00× (instant bust, payout editable, default 49.99×)** plus the 27 cash-out points.
- **Rules:** always bet a point · bet a point after N losses in a row · after a round below Y · after a round at or above Y · best ROI over the last W rounds · most "due" point · highest score · random.
- **Staking:** flat, or martingale (× after a loss, max steps), with an optional bankroll that stops the test when it runs out.
- **Output:** return %, the **luck range** (where 95% of results land for that rule if the game is fair), bets, wins, profit, biggest drawdown, longest losing streak, biggest stake, a profit chart, and bets by point.
- **Compare all rules** runs 14 preset rules on the same rounds; click a row to test it.

Results on 1,000,000 real rounds (8745448–9745447, flat stake):

| Rule | Bets | Return | Luck range |
|---|---|---|---|
| Always 1.01× | 999,999 | −0.99% | −1.03% to −0.97% |
| Always 2× | 999,999 | −0.85% | −1.20% to −0.80% |
| Always 1.00× (instant bust, 49.99×) | 999,999 | −1.43% | −2.37% to +0.36% |
| 2× after 3 losses in a row | 128,243 | −1.00% | −1.55% to −0.45% |
| 1.00× after a round below 1.01× | 19,718 | +2.42% | −10.73% to +8.71% |
| Best ROI, last 100 rounds | 999,900 | −0.29% | −1.84% to −0.16% |
| Random point | 999,999 | −1.35% | −1.37% to −0.63% |

Every rule lands inside (or right at the edge of) its luck range: none beats chance. Martingale on 2× with a 1,000 bankroll ran out after 387 bets.

### Score per point (live)
**Score per point** (popup) scores **27 points** (1.01–1.10 step 0.01, 1.2–2.0 step 0.1, 3–10 step 1) over the last 2,000 rounds by default (10,000, 100,000 or 1,000,000 selectable), and **recalculates every round** while the bc.game crash tab is open.

| Point | Score | Hit rate | Normal | ROI | Win vs loss | After a loss | Longest losing streak |
|---|---|---|---|---|---|---|---|
| 1.04× | 7.4 ▼0.1 | 95.10% | 95.19% | −1.10% | 1 loss = 25 wins | 90.72% | 2 |
| 2× | 6.8 | 51.80% | 49.50% | +3.60% | 1 win = 1 loss | 52.65% | 9 |

**Score (0–10, graded)** = how close the point is to what a fair game expects. Each check turns its deviation (in standard deviations, z) into points: z = 0 gives full points, |z| ≥ 4 gives none. Weights: hit rate vs fair game 3, after a loss = after a win 2, autocorrelation 1, runs 1, losing streak 1, stability 1, trend 1. Fair data usually scores 7–10 and moves up and down by chance each round. **A higher score does not mean a point is more likely to win.** Hover a score to see its parts.

**Live updates:** the extension reads each new result from bc.game's result strip as it appears (no clicking) and adds it to the scores. These rounds are confirmed by the hash chain when the next hash is read. The toolbar badge shows the latest result.

What the data shows (1,000,000 rounds, 8745448–9745447): every point returns about −1% in the long run (ROI −0.84% to −1.42%), so there is no best point for earning. Short samples can show positive ROI by luck. A low round does not make the next one more likely to hit: at 1.1×, the hit rate is 89.95% after a loss vs 90.07% after a win.

### Detailed statistics
Below the live scores, **Run analysis** reports (about 10 s for 1,000,000 rounds):

- **Hit rates** for all 27 points: successes, rounds, hit/fail rate, 95% Wilson interval and its half-width.
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
npm run report -- <hash> [rounds] [roundId] [--edge=0.01] [--detail] [--json=out.json]   # score per point
```

## Formula

- **Previous round's hash** = SHA-256 of the current hash (as hex text).
- **Crash point**: HMAC-SHA256 with the salt as key and the hash bytes as message. Take the first 52 bits as `X / 2^52`, round to 9 significant digits, then `crash = floor(99 / (1 - X)) / 100`, minimum 1.00×.

Example: round 9745447, hash `0ab60395…0b7e`, salt `0000…e2f9` → **8.17×**.

The chain only runs backwards: a hash gives you every earlier round, not the next one.
