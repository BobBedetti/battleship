# Testing the Battleship Game

## Local Setup

```bash
cd /home/ubuntu/repos/battleship
python3 -m http.server 8080 &
```

The game is a single `index.html` file with all JS inline. No build step needed. Open `http://localhost:8080` in Chrome.

## Running Unit Tests

```bash
cd /home/ubuntu/repos/battleship
npm test
```

Tests use Node's built-in test runner with `node:test` and `node:assert`. Test file: `tests/game-logic.test.js`. Game logic is in `js/game-logic.js`.

## Game UI Flow

1. **Setup screen**: Select difficulty (Easy/Normal/Admiral), fleet composition, captain
2. Click **"Deploy to Battle"** to enter placement phase
3. Click **"Random Placement"** for quick ship placement (or click grid cells to place manually)
4. Click **"Engage Enemy"** to start the game
5. **Gameplay**: Click cells on the enemy grid to fire. After each shot, the AI fires back after ~800ms delay.
6. AI shots appear on the "Your Fleet" grid: red X = hit, splash = miss

## Inspecting AI State

The game state is accessible via `state.enemyAI` in the browser. The `computer` tool's `console` action may not always detect Chrome as foreground. Use **Playwright CDP** instead for reliable state inspection:

```python
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp("http://localhost:29229")
    context = browser.contexts[0]
    page = [pg for pg in context.pages if "8080" in pg.url][0]
    result = page.evaluate("""() => {
        return JSON.stringify({
            mode: state.enemyAI.mode,
            firstHit: state.enemyAI.firstHit,
            confirmedDir: state.enemyAI.confirmedDir,
            hitStack: state.enemyAI.hitStack,
            targetQueue: state.enemyAI.targetQueue,
            difficulty: state.enemyAI.difficulty
        }, null, 2);
    }""")
    print(result)
    browser.close()
```

Install Playwright if needed: `pip install playwright && python3 -m playwright install chromium`

## Key AI State Fields

- `mode`: `'hunt'` (searching) or `'target'` (following a hit)
- `firstHit`: `[row, col]` of the initial hit that started targeting
- `confirmedDir`: `[dr, dc]` direction vector locked after 2 collinear hits (e.g., `[0,1]` = horizontal right)
- `hitStack`: Array of `[row, col]` hits in the current targeting chain
- `targetQueue`: Array of `[row, col]` cells the AI plans to shoot next
- `difficulty`: `'easy'`, `'normal'`, or `'admiral'`

## Testing AI Behavior

To test AI targeting intelligence:
1. Start a game and fire shots on the enemy grid to trigger AI turns
2. After each AI turn, use Playwright to inspect `state.enemyAI`
3. Verify: after a hit, `mode='target'` and `firstHit` is set
4. Verify: after 2 collinear hits, `confirmedDir` locks and `targetQueue` has only forward/backward
5. Verify: after a miss in confirmed direction, AI reverses to try the other end
6. Verify: after sinking a ship, AI resets to `mode='hunt'` with all targeting state cleared

You can also inspect the player board state:
```javascript
// Get all enemy shots on the player board
const b = state.playerBoard;
for (const key of b.shotsTaken) {
    const [r,c] = key.split(',').map(Number);
    console.log(r, c, b.grid[r][c] ? 'hit' : 'miss');
}
```

## Grid Coordinate System

- Columns: A=0, B=1, C=2, ... J=9
- Rows: 1=0, 2=1, 3=2, ... 10=9
- So grid cell "D4" = `[3, 3]` (0-indexed)

## Difficulty Levels

- **Easy**: Random firing
- **Normal**: Hunt/target with checkerboard pattern
- **Admiral**: Probability-based targeting (heatmap)

Both Normal and Admiral use the same line-following logic after a hit.

## Devin Secrets Needed

None — the game is a static HTML file with no backend or API keys.
