/* ============================================================
   BATTLESHIP — Pure Game Logic
   ============================================================
   This module contains all of the game logic that is independent
   of the DOM. It is loaded directly by index.html via a <script>
   tag (attaching to window) and is also importable as a CommonJS
   module for unit testing in Node.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    // Browser: attach every exported symbol to window so the
    // existing inline game script can use them as before.
    for (const key of Object.keys(api)) {
      root[key] = api[key];
    }
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* ==========================================================
     CONSTANTS
     ========================================================== */
  const DEFAULT_SHIPS = [
    { name: 'Carrier',    size: 5, key: 'carrier',    icon: '🚢' },
    { name: 'Battleship', size: 4, key: 'battleship', icon: '⚓' },
    { name: 'Cruiser',    size: 3, key: 'cruiser',    icon: '🛳' },
    { name: 'Submarine',  size: 3, key: 'submarine',  icon: '🔱' },
    { name: 'Destroyer',  size: 2, key: 'destroyer',  icon: '⛴' },
    { name: 'Patrol',     size: 1, key: 'patrol',     icon: '🚤' }
  ];

  const DEFAULT_QUANTITIES = {
    carrier: 1, battleship: 1, cruiser: 1, submarine: 1, destroyer: 1, patrol: 0
  };

  const DIFFICULTY_INFO = {
    easy:    { label: 'Cadet',   multiplier: 0.5 },
    normal:  { label: 'Officer', multiplier: 1.0 },
    admiral: { label: 'Admiral', multiplier: 1.5 }
  };

  const CAPTAIN_INFO = {
    scout:    { name: 'The Scout',    icon: '🔭', desc: 'Reveal one full row of enemy waters.' },
    engineer: { name: 'The Engineer', icon: '🔧', desc: 'Repair two damaged cells on your fleet.' },
    gunner:   { name: 'The Gunner',   icon: '💥', desc: 'Fire a 2×2 area blast.' }
  };

  /* ==========================================================
     ORIENTATIONS
     ========================================================== */
  function getOrientationDelta(orientation) {
    switch (orientation) {
      case 'horizontal': return [0, 1];
      case 'vertical':   return [1, 0];
      case 'diag-down':  return [1, 1];
      case 'diag-up':    return [-1, 1];
      default: return [0, 1];
    }
  }

  function nextOrientation(orient, allowDiag) {
    const seq = allowDiag
      ? ['horizontal', 'vertical', 'diag-down', 'diag-up']
      : ['horizontal', 'vertical'];
    const i = seq.indexOf(orient);
    // If orient isn't in the sequence (e.g. was 'diag-down' but diagonals
    // are no longer allowed), recover by starting at the first element.
    if (i === -1) return seq[0];
    return seq[(i + 1) % seq.length];
  }

  /* ==========================================================
     BOARD
     ========================================================== */
  function makeBoard(size) {
    return {
      size,
      ships: [],
      grid: Array.from({ length: size }, () => Array(size).fill(null)),
      shotsTaken: new Set()
    };
  }

  function cellInBounds(board, r, c) {
    return r >= 0 && r < board.size && c >= 0 && c < board.size;
  }

  function getShipCells(r, c, size, orientation) {
    const [dr, dc] = getOrientationDelta(orientation);
    const cells = [];
    for (let i = 0; i < size; i++) {
      cells.push([r + dr * i, c + dc * i]);
    }
    return cells;
  }

  function canPlace(board, r, c, size, orientation) {
    const cells = getShipCells(r, c, size, orientation);
    for (const [rr, cc] of cells) {
      if (!cellInBounds(board, rr, cc)) return false;
      if (board.grid[rr][cc] !== null) return false;
    }
    return true;
  }

  function placeShip(board, shipDef, r, c, orientation) {
    const cells = getShipCells(r, c, shipDef.size, orientation);
    const ship = {
      ...shipDef,
      cells,
      hits: new Set(),
      orientation,
      instanceId: `${shipDef.key}-${board.ships.length}`
    };
    for (const [rr, cc] of cells) {
      board.grid[rr][cc] = ship.instanceId;
    }
    board.ships.push(ship);
    return ship;
  }

  function randomPlacement(board, shipsQueue, allowDiag) {
    board.ships = [];
    board.grid = Array.from({ length: board.size }, () => Array(board.size).fill(null));

    const orientations = allowDiag
      ? ['horizontal', 'vertical', 'diag-down', 'diag-up']
      : ['horizontal', 'vertical'];

    for (const shipDef of shipsQueue) {
      let placed = false, tries = 0;
      while (!placed && tries < 500) {
        const orient = orientations[Math.floor(Math.random() * orientations.length)];
        const r = Math.floor(Math.random() * board.size);
        const c = Math.floor(Math.random() * board.size);
        if (canPlace(board, r, c, shipDef.size, orient)) {
          placeShip(board, shipDef, r, c, orient);
          placed = true;
        }
        tries++;
      }
      if (!placed) return false;
    }
    return true;
  }

  /* ==========================================================
     FLEET QUEUE
     ========================================================== */
  function buildFleetQueue(fleet) {
    const queue = [];
    const sorted = [...DEFAULT_SHIPS].sort((a, b) => b.size - a.size);
    for (const shipDef of sorted) {
      const qty = fleet[shipDef.key] || 0;
      for (let i = 0; i < qty; i++) {
        queue.push({ ...shipDef });
      }
    }
    return queue;
  }

  function totalFleetCells(fleet) {
    return DEFAULT_SHIPS.reduce((sum, s) => sum + (fleet[s.key] || 0) * s.size, 0);
  }

  function totalFleetCount(fleet) {
    return DEFAULT_SHIPS.reduce((sum, s) => sum + (fleet[s.key] || 0), 0);
  }

  /* ==========================================================
     SHOT RESOLUTION
     ========================================================== */
  function processShot(board, r, c) {
    const key = `${r},${c}`;
    if (board.shotsTaken.has(key)) return null;
    board.shotsTaken.add(key);

    const shipId = board.grid[r][c];
    if (!shipId) return { result: 'miss', r, c };

    const ship = board.ships.find(s => s.instanceId === shipId);
    ship.hits.add(key);
    const sunk = ship.hits.size === ship.cells.length;
    return { result: 'hit', r, c, ship, sunk };
  }

  function allShipsSunk(board) {
    return board.ships.length > 0 && board.ships.every(s => s.hits.size === s.cells.length);
  }

  function isHitCell(board, r, c) {
    const shipId = board.grid[r][c];
    if (!shipId) return false;
    const ship = board.ships.find(s => s.instanceId === shipId);
    return !!(ship && ship.hits.has(`${r},${c}`));
  }

  /* ==========================================================
     ENEMY AI
     ========================================================== */
  function makeAI(difficulty) {
    return {
      difficulty,
      mode: 'hunt',
      targetQueue: [],
      hitStack: [],
      lastHit: null
    };
  }

  function aiChooseShot(ai, board, allowDiag) {
    if (ai.difficulty === 'easy') return aiRandomShot(board);
    if (ai.difficulty === 'admiral') return aiProbabilityShot(ai, board, allowDiag);
    return aiHuntTarget(ai, board);
  }

  function aiRandomShot(board) {
    const options = [];
    for (let r = 0; r < board.size; r++) {
      for (let c = 0; c < board.size; c++) {
        if (!board.shotsTaken.has(`${r},${c}`)) options.push([r, c]);
      }
    }
    if (options.length === 0) return null;
    return options[Math.floor(Math.random() * options.length)];
  }

  function aiHuntTarget(ai, board) {
    while (ai.targetQueue.length > 0) {
      const next = ai.targetQueue.shift();
      if (cellInBounds(board, next[0], next[1]) && !board.shotsTaken.has(`${next[0]},${next[1]}`)) {
        return next;
      }
    }

    // Target queue drained. If we still have stale hits from a partially-
    // damaged (but not sunk) ship that we've given up on, drop them so a
    // future hunt-phase hit isn't misinterpreted as part of the old chain.
    if (ai.hitStack.length > 0) {
      ai.hitStack = [];
      ai.mode = 'hunt';
    }

    // Checkerboard hunt
    const candidates = [];
    for (let r = 0; r < board.size; r++) {
      for (let c = 0; c < board.size; c++) {
        if ((r + c) % 2 === 0 && !board.shotsTaken.has(`${r},${c}`)) candidates.push([r, c]);
      }
    }
    if (candidates.length === 0) {
      for (let r = 0; r < board.size; r++) {
        for (let c = 0; c < board.size; c++) {
          if (!board.shotsTaken.has(`${r},${c}`)) candidates.push([r, c]);
        }
      }
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function aiProbabilityShot(ai, board, allowDiag) {
    while (ai.targetQueue.length > 0) {
      const next = ai.targetQueue.shift();
      if (cellInBounds(board, next[0], next[1]) && !board.shotsTaken.has(`${next[0]},${next[1]}`)) {
        return next;
      }
    }

    const remainingShips = board.ships.filter(s => s.hits.size < s.cells.length);
    const heat = Array.from({ length: board.size }, () => Array(board.size).fill(0));

    const orientations = allowDiag
      ? ['horizontal', 'vertical', 'diag-down', 'diag-up']
      : ['horizontal', 'vertical'];

    const sizesRemaining = remainingShips.map(s => s.cells.length);
    const uniqueSizes = [...new Set(sizesRemaining)];

    for (const size of uniqueSizes) {
      const count = sizesRemaining.filter(s => s === size).length;
      for (let r = 0; r < board.size; r++) {
        for (let c = 0; c < board.size; c++) {
          for (const orient of orientations) {
            const cells = getShipCells(r, c, size, orient);
            let valid = true;
            for (const [rr, cc] of cells) {
              if (!cellInBounds(board, rr, cc)) { valid = false; break; }
              const k = `${rr},${cc}`;
              if (board.shotsTaken.has(k) && !isHitCell(board, rr, cc)) { valid = false; break; }
            }
            if (valid) {
              for (const [rr, cc] of cells) {
                if (!board.shotsTaken.has(`${rr},${cc}`)) {
                  heat[rr][cc] += count;
                }
              }
            }
          }
        }
      }
    }

    let best = [], bestScore = -1;
    for (let r = 0; r < board.size; r++) {
      for (let c = 0; c < board.size; c++) {
        if (board.shotsTaken.has(`${r},${c}`)) continue;
        if (heat[r][c] > bestScore) {
          bestScore = heat[r][c];
          best = [[r, c]];
        } else if (heat[r][c] === bestScore) {
          best.push([r, c]);
        }
      }
    }

    if (best.length === 0) return aiRandomShot(board);
    return best[Math.floor(Math.random() * best.length)];
  }

  function aiUpdateAfterShot(ai, shot, allowDiag) {
    if (ai.difficulty === 'easy') return;
    if (shot.result !== 'hit') return;

    ai.hitStack.push([shot.r, shot.c]);
    if (shot.sunk) {
      ai.mode = 'hunt';
      ai.targetQueue = [];
      ai.hitStack = [];
      return;
    }
    ai.mode = 'target';

    if (ai.hitStack.length >= 2) {
      const [a, b] = [ai.hitStack[ai.hitStack.length - 2], ai.hitStack[ai.hitStack.length - 1]];
      const dr = Math.sign(b[0] - a[0]), dc = Math.sign(b[1] - a[1]);
      if (dr === 0 && dc === 0) {
        addNeighbors(ai, shot.r, shot.c, allowDiag);
      } else {
        const forward = [b[0] + dr, b[1] + dc];
        const backward = [a[0] - dr, a[1] - dc];
        ai.targetQueue = [forward, backward];
      }
    } else {
      addNeighbors(ai, shot.r, shot.c, allowDiag);
    }
  }

  function addNeighbors(ai, r, c, allowDiag) {
    const neighbors = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
    if (allowDiag) {
      neighbors.push([r - 1, c - 1], [r - 1, c + 1], [r + 1, c - 1], [r + 1, c + 1]);
    }
    ai.targetQueue.push(...neighbors);
  }

  /* ==========================================================
     EXPORTS
     ========================================================== */
  return {
    DEFAULT_SHIPS,
    DEFAULT_QUANTITIES,
    DIFFICULTY_INFO,
    CAPTAIN_INFO,
    getOrientationDelta,
    nextOrientation,
    makeBoard,
    cellInBounds,
    getShipCells,
    canPlace,
    placeShip,
    randomPlacement,
    buildFleetQueue,
    totalFleetCells,
    totalFleetCount,
    processShot,
    allShipsSunk,
    isHitCell,
    makeAI,
    aiChooseShot,
    aiRandomShot,
    aiHuntTarget,
    aiProbabilityShot,
    aiUpdateAfterShot,
    addNeighbors
  };
});
