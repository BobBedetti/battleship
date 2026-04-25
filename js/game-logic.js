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
      lastHit: null,
      firstHit: null,       // [r, c] of the hit that started the current chain
      confirmedDir: null     // [dr, dc] once two collinear hits lock a direction
    };
  }

  function aiChooseShot(ai, board, allowDiag) {
    if (ai.difficulty === 'easy') return aiRandomShot(board);
    if (ai.difficulty === 'admiral') return aiProbabilityShot(ai, board, allowDiag);
    return aiHuntTarget(ai, board, allowDiag);
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

  function aiHuntTarget(ai, board, allowDiag) {
    while (ai.targetQueue.length > 0) {
      const next = ai.targetQueue.shift();
      if (cellInBounds(board, next[0], next[1]) && !board.shotsTaken.has(`${next[0]},${next[1]}`)) {
        return next;
      }
    }

    // Target queue drained while still tracking an unsunk ship.
    if (ai.hitStack.length > 0 && ai.firstHit) {
      // Try perpendicular directions from firstHit before giving up.
      if (ai.confirmedDir) {
        aiQueuePerpendicular(ai, allowDiag);
        while (ai.targetQueue.length > 0) {
          const next = ai.targetQueue.shift();
          if (cellInBounds(board, next[0], next[1]) && !board.shotsTaken.has(`${next[0]},${next[1]}`)) {
            return next;
          }
        }
      }
      // Perpendicular also exhausted (or no confirmed direction) — reset.
      aiResetToHunt(ai);
    } else if (ai.hitStack.length > 0) {
      // Stale hits without firstHit (shouldn't normally happen) — clean up.
      aiResetToHunt(ai);
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

    // Target queue drained while still tracking an unsunk ship.
    if (ai.hitStack.length > 0 && ai.firstHit) {
      if (ai.confirmedDir) {
        aiQueuePerpendicular(ai, allowDiag);
        while (ai.targetQueue.length > 0) {
          const next = ai.targetQueue.shift();
          if (cellInBounds(board, next[0], next[1]) && !board.shotsTaken.has(`${next[0]},${next[1]}`)) {
            return next;
          }
        }
      }
      aiResetToHunt(ai);
    } else if (ai.hitStack.length > 0) {
      aiResetToHunt(ai);
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

    /* ---- Miss handling ---- */
    if (shot.result === 'miss') {
      if (ai.mode === 'target' && ai.confirmedDir && ai.targetQueue.length === 0) {
        aiQueuePerpendicular(ai, allowDiag);
      }
      return;
    }

    if (shot.result !== 'hit') return;

    ai.hitStack.push([shot.r, shot.c]);

    /* ---- Sunk handling ---- */
    if (shot.sunk) {
      const sunkCells = shot.ship
        ? new Set(shot.ship.cells.map(([r, c]) => `${r},${c}`))
        : null;
      if (sunkCells) {
        ai.hitStack = ai.hitStack.filter(([r, c]) => !sunkCells.has(`${r},${c}`));
      } else {
        ai.hitStack = [];
      }

      if (ai.hitStack.length > 0) {
        // Leftover hits from an adjacent ship — keep targeting
        ai.firstHit = ai.hitStack[0];
        ai.confirmedDir = null;
        ai.targetQueue = [];
        ai.mode = 'target';
        if (ai.hitStack.length >= 2) {
          aiLockDirection(ai);
        } else {
          addNeighbors(ai, ai.firstHit[0], ai.firstHit[1], allowDiag);
        }
      } else {
        aiResetToHunt(ai);
      }
      return;
    }

    /* ---- Hit (not sunk) ---- */
    ai.mode = 'target';

    if (ai.hitStack.length === 1) {
      ai.firstHit = [shot.r, shot.c];
      ai.confirmedDir = null;
      addNeighbors(ai, shot.r, shot.c, allowDiag);
    } else {
      aiLockDirection(ai);
    }
  }

  function aiLockDirection(ai) {
    const first = ai.firstHit;
    const last = ai.hitStack[ai.hitStack.length - 1];
    const dr = Math.sign(last[0] - first[0]);
    const dc = Math.sign(last[1] - first[1]);
    if (dr === 0 && dc === 0) return;

    ai.confirmedDir = [dr, dc];

    // Find the extreme endpoints of the hit chain along confirmedDir
    let minProj = Infinity, maxProj = -Infinity;
    let minHit, maxHit;
    for (const h of ai.hitStack) {
      const proj = h[0] * dr + h[1] * dc;
      if (proj <= minProj) { minProj = proj; minHit = h; }
      if (proj >= maxProj) { maxProj = proj; maxHit = h; }
    }

    ai.targetQueue = [
      [maxHit[0] + dr, maxHit[1] + dc],   // forward
      [minHit[0] - dr, minHit[1] - dc]    // backward
    ];
  }

  function aiQueuePerpendicular(ai, allowDiag) {
    if (!ai.firstHit) return;
    const [r, c] = ai.firstHit;
    const [dr, dc] = ai.confirmedDir || [0, 0];

    ai.targetQueue = [];
    ai.confirmedDir = null;

    if (!allowDiag) {
      if (dr === 0) {
        // Was horizontal → try vertical
        ai.targetQueue.push([r - 1, c], [r + 1, c]);
      } else {
        // Was vertical → try horizontal
        ai.targetQueue.push([r, c - 1], [r, c + 1]);
      }
    } else {
      // Diagonal mode: try every direction except confirmed and its reverse
      const allDirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
      for (const [ddr, ddc] of allDirs) {
        if ((ddr === dr && ddc === dc) || (ddr === -dr && ddc === -dc)) continue;
        ai.targetQueue.push([r + ddr, c + ddc]);
      }
    }
  }

  function aiResetToHunt(ai) {
    ai.mode = 'hunt';
    ai.targetQueue = [];
    ai.hitStack = [];
    ai.firstHit = null;
    ai.confirmedDir = null;
  }

  function addNeighbors(ai, r, c, allowDiag) {
    const neighbors = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
    if (allowDiag) {
      neighbors.push([r - 1, c - 1], [r - 1, c + 1], [r + 1, c - 1], [r + 1, c + 1]);
    }
    ai.targetQueue.push(...neighbors);
  }

  /* ==========================================================
     SINK ANNOUNCEMENTS
     ========================================================== */
  function getSinkAnnouncement(side, shipName) {
    const name = shipName || 'ship';
    if (side === 'player') return `You sank my ${name}!`;
    if (side === 'enemy')  return `We've lost our ${name}!`;
    return '';
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
    aiLockDirection,
    aiQueuePerpendicular,
    aiResetToHunt,
    addNeighbors,
    getSinkAnnouncement
  };
});
