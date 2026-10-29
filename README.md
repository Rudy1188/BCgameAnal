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
2. Click the extension icon, then **Get latest round**. It opens the newest round in the page's result strip, reads its **Round ID / Salt / Hash** box, and closes it.
3. New rounds are also picked up on their own, whenever a round's details box is open or the page's data contains a hash that chains back to the saved one (SHA-256).
4. The popup shows the latest round, copy buttons for the hash/salt, and earlier rounds (with a CSV download). The icon badge shows the latest crash point.

If **Get latest round** fails, the popup shows what it found on the page (useful for fixing it), and you can still enter a round by hand.

## Node calculator (`src/`, `public/`)

```
npm install
npm run build
npm start                                   # web page at http://127.0.0.1:3000
npm run calc -- <hash> [count] [roundId]   # command line
```

## Formula

- **Previous round's hash** = SHA-256 of the current hash (as hex text).
- **Crash point**: HMAC-SHA256 with the salt as key and the hash bytes as message. Take the first 52 bits as `X / 2^52`, round to 9 significant digits, then `crash = floor(99 / (1 - X)) / 100`, minimum 1.00×.

Example: round 9745447, hash `0ab60395…0b7e`, salt `0000…e2f9` → **8.17×**.

The chain only runs backwards: a hash gives you every earlier round, not the next one.
