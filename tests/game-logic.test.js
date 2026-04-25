'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
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
} = require('../js/game-logic.js');

/* ============================================================
   Test helpers
   ============================================================ */
function withStubbedRandom(values, fn) {
  const real = Math.random;
  let i = 0;
  Math.random = () => {
    if (i >= values.length) throw new Error(`Math.random called more than expected (${values.length} values supplied)`);
    return values[i++];
  };
  try {
    return fn();
  } finally {
    Math.random = real;
  }
}

function shipDef(key, size, name = key) {
  return { key, size, name, icon: '⚓' };
}

/* ============================================================
   Constants
   ============================================================ */
test('DEFAULT_SHIPS contains the expected 6 ship classes', () => {
  assert.equal(DEFAULT_SHIPS.length, 6);
  const keys = DEFAULT_SHIPS.map(s => s.key);
  assert.deepEqual(keys.sort(), ['battleship', 'carrier', 'cruiser', 'destroyer', 'patrol', 'submarine']);
  // Sizes match classic Battleship plus a 1-cell patrol boat
  const sizes = Object.fromEntries(DEFAULT_SHIPS.map(s => [s.key, s.size]));
  assert.equal(sizes.carrier, 5);
  assert.equal(sizes.battleship, 4);
  assert.equal(sizes.cruiser, 3);
  assert.equal(sizes.submarine, 3);
  assert.equal(sizes.destroyer, 2);
  assert.equal(sizes.patrol, 1);
});

test('DEFAULT_QUANTITIES has an entry for every default ship', () => {
  for (const s of DEFAULT_SHIPS) {
    assert.ok(Object.prototype.hasOwnProperty.call(DEFAULT_QUANTITIES, s.key), `missing quantity for ${s.key}`);
  }
});

test('DIFFICULTY_INFO defines the three difficulty tiers', () => {
  assert.deepEqual(Object.keys(DIFFICULTY_INFO).sort(), ['admiral', 'easy', 'normal']);
  for (const key of Object.keys(DIFFICULTY_INFO)) {
    assert.ok(typeof DIFFICULTY_INFO[key].label === 'string');
    assert.ok(typeof DIFFICULTY_INFO[key].multiplier === 'number');
  }
});

test('CAPTAIN_INFO defines the three captain archetypes', () => {
  assert.deepEqual(Object.keys(CAPTAIN_INFO).sort(), ['engineer', 'gunner', 'scout']);
});

/* ============================================================
   Orientation helpers
   ============================================================ */
test('getOrientationDelta returns the correct direction vector', () => {
  assert.deepEqual(getOrientationDelta('horizontal'), [0, 1]);
  assert.deepEqual(getOrientationDelta('vertical'),   [1, 0]);
  assert.deepEqual(getOrientationDelta('diag-down'),  [1, 1]);
  assert.deepEqual(getOrientationDelta('diag-up'),    [-1, 1]);
});

test('getOrientationDelta falls back to horizontal for unknown orientations', () => {
  assert.deepEqual(getOrientationDelta('bogus'), [0, 1]);
  assert.deepEqual(getOrientationDelta(undefined), [0, 1]);
});

test('nextOrientation cycles between horizontal and vertical when diagonals disabled', () => {
  assert.equal(nextOrientation('horizontal', false), 'vertical');
  assert.equal(nextOrientation('vertical', false), 'horizontal');
});

test('nextOrientation cycles through all four orientations when diagonals enabled', () => {
  assert.equal(nextOrientation('horizontal', true), 'vertical');
  assert.equal(nextOrientation('vertical', true), 'diag-down');
  assert.equal(nextOrientation('diag-down', true), 'diag-up');
  assert.equal(nextOrientation('diag-up', true), 'horizontal');
});

test('nextOrientation recovers gracefully if current orientation is no longer allowed', () => {
  // E.g. user had diag-down selected, then disabled diagonals.
  assert.equal(nextOrientation('diag-down', false), 'horizontal');
  assert.equal(nextOrientation('diag-up', false), 'horizontal');
});

/* ============================================================
   Board & placement
   ============================================================ */
test('makeBoard creates an empty size×size grid', () => {
  const b = makeBoard(10);
  assert.equal(b.size, 10);
  assert.equal(b.ships.length, 0);
  assert.equal(b.shotsTaken.size, 0);
  assert.equal(b.grid.length, 10);
  for (const row of b.grid) {
    assert.equal(row.length, 10);
    assert.ok(row.every(v => v === null));
  }
});

test('cellInBounds respects board edges', () => {
  const b = makeBoard(5);
  assert.equal(cellInBounds(b, 0, 0), true);
  assert.equal(cellInBounds(b, 4, 4), true);
  assert.equal(cellInBounds(b, -1, 0), false);
  assert.equal(cellInBounds(b, 0, -1), false);
  assert.equal(cellInBounds(b, 5, 0), false);
  assert.equal(cellInBounds(b, 0, 5), false);
});

test('getShipCells lays out cells along the chosen orientation', () => {
  assert.deepEqual(
    getShipCells(2, 3, 3, 'horizontal'),
    [[2, 3], [2, 4], [2, 5]]
  );
  assert.deepEqual(
    getShipCells(2, 3, 3, 'vertical'),
    [[2, 3], [3, 3], [4, 3]]
  );
  assert.deepEqual(
    getShipCells(1, 1, 3, 'diag-down'),
    [[1, 1], [2, 2], [3, 3]]
  );
  assert.deepEqual(
    getShipCells(3, 1, 3, 'diag-up'),
    [[3, 1], [2, 2], [1, 3]]
  );
});

test('canPlace rejects out-of-bounds placements', () => {
  const b = makeBoard(5);
  assert.equal(canPlace(b, 0, 3, 3, 'horizontal'), false, 'runs off the right edge');
  assert.equal(canPlace(b, 3, 0, 3, 'vertical'), false, 'runs off the bottom');
  assert.equal(canPlace(b, 0, 0, 3, 'diag-up'), false, 'runs off the top');
});

test('canPlace rejects placements that overlap an existing ship', () => {
  const b = makeBoard(5);
  placeShip(b, shipDef('carrier', 3), 0, 0, 'horizontal');
  assert.equal(canPlace(b, 0, 2, 2, 'horizontal'), false, 'overlaps the tail');
  assert.equal(canPlace(b, 0, 1, 1, 'horizontal'), false, 'sits exactly on a cell');
  assert.equal(canPlace(b, 1, 0, 3, 'horizontal'), true, 'parallel ship one row below is fine');
});

test('placeShip stamps instanceId onto every cell and exposes cells/hits', () => {
  const b = makeBoard(5);
  const ship = placeShip(b, shipDef('destroyer', 2), 1, 1, 'vertical');
  assert.equal(ship.instanceId, 'destroyer-0');
  assert.deepEqual(ship.cells, [[1, 1], [2, 1]]);
  assert.equal(ship.hits.size, 0);
  assert.equal(b.grid[1][1], 'destroyer-0');
  assert.equal(b.grid[2][1], 'destroyer-0');
  // unrelated cell untouched
  assert.equal(b.grid[0][0], null);
});

test('placeShip assigns unique instanceIds to duplicates of the same class', () => {
  const b = makeBoard(6);
  placeShip(b, shipDef('patrol', 1), 0, 0, 'horizontal');
  placeShip(b, shipDef('patrol', 1), 5, 5, 'horizontal');
  const ids = b.ships.map(s => s.instanceId);
  assert.equal(new Set(ids).size, 2);
});

test('randomPlacement fits a full default fleet on a 10×10 grid', () => {
  withStubbedRandom([], () => {}); // sanity: stub helper exists
  const b = makeBoard(10);
  const queue = buildFleetQueue(DEFAULT_QUANTITIES);
  const ok = randomPlacement(b, queue, false);
  assert.equal(ok, true);
  assert.equal(b.ships.length, queue.length);
  // No overlaps: total stamped cells == sum of ship sizes
  const stamped = b.grid.flat().filter(v => v !== null).length;
  const expected = queue.reduce((n, s) => n + s.size, 0);
  assert.equal(stamped, expected);
});

test('randomPlacement returns false when the fleet cannot fit', () => {
  const b = makeBoard(3);
  // Two 3-cell ships cannot both fit on a 3×3 without overlap
  const queue = [shipDef('a', 3), shipDef('b', 3), shipDef('c', 3), shipDef('d', 3), shipDef('e', 3)];
  const ok = randomPlacement(b, queue, false);
  // May or may not succeed up to 3 placements but with 5×3=15 > 9, guaranteed fail
  assert.equal(ok, false);
});

/* ============================================================
   Fleet queue & capacity
   ============================================================ */
test('buildFleetQueue expands quantities and sorts by size descending', () => {
  const queue = buildFleetQueue({ carrier: 1, battleship: 1, cruiser: 0, submarine: 0, destroyer: 2, patrol: 3 });
  assert.equal(queue.length, 7);
  // Carrier (5) first, then Battleship (4), then Destroyers (2, 2), then Patrols (1, 1, 1)
  assert.deepEqual(queue.map(s => s.size), [5, 4, 2, 2, 1, 1, 1]);
});

test('buildFleetQueue ignores unknown ship keys in the fleet map', () => {
  const queue = buildFleetQueue({ carrier: 1, nonsense: 99 });
  assert.equal(queue.length, 1);
  assert.equal(queue[0].key, 'carrier');
});

test('buildFleetQueue produces independent ship-def copies', () => {
  const queue = buildFleetQueue({ destroyer: 2 });
  assert.equal(queue.length, 2);
  queue[0].size = 99;
  assert.equal(queue[1].size, 2, 'mutating one queue entry should not affect another');
});

test('totalFleetCells and totalFleetCount sum correctly', () => {
  const fleet = { carrier: 1, battleship: 1, cruiser: 1, submarine: 1, destroyer: 1, patrol: 0 };
  assert.equal(totalFleetCells(fleet), 5 + 4 + 3 + 3 + 2);
  assert.equal(totalFleetCount(fleet), 5);
  assert.equal(totalFleetCells({}), 0);
  assert.equal(totalFleetCount({}), 0);
});

/* ============================================================
   Shot resolution
   ============================================================ */
test('processShot returns miss for empty water and records the shot', () => {
  const b = makeBoard(5);
  const shot = processShot(b, 2, 2);
  assert.equal(shot.result, 'miss');
  assert.equal(b.shotsTaken.has('2,2'), true);
});

test('processShot returns null for a cell that has already been shot', () => {
  const b = makeBoard(5);
  processShot(b, 2, 2);
  assert.equal(processShot(b, 2, 2), null);
});

test('processShot marks hits, tracks ship.hits, and flags sunk on the final cell', () => {
  const b = makeBoard(5);
  placeShip(b, shipDef('destroyer', 2), 0, 0, 'horizontal');

  const first = processShot(b, 0, 0);
  assert.equal(first.result, 'hit');
  assert.equal(first.sunk, false);
  assert.equal(first.ship.hits.size, 1);

  const second = processShot(b, 0, 1);
  assert.equal(second.result, 'hit');
  assert.equal(second.sunk, true);
  assert.equal(second.ship.hits.size, 2);
});

test('allShipsSunk requires at least one ship and all cells hit', () => {
  const empty = makeBoard(5);
  assert.equal(allShipsSunk(empty), false, 'empty board should not report victory');

  const b = makeBoard(5);
  placeShip(b, shipDef('patrol', 1), 0, 0, 'horizontal');
  assert.equal(allShipsSunk(b), false);
  processShot(b, 0, 0);
  assert.equal(allShipsSunk(b), true);
});

test('isHitCell correctly identifies damaged vs undamaged ship cells', () => {
  const b = makeBoard(5);
  placeShip(b, shipDef('destroyer', 2), 0, 0, 'horizontal');
  assert.equal(isHitCell(b, 0, 0), false);
  assert.equal(isHitCell(b, 0, 1), false);
  assert.equal(isHitCell(b, 3, 3), false, 'water is never a hit cell');
  processShot(b, 0, 0);
  assert.equal(isHitCell(b, 0, 0), true);
  assert.equal(isHitCell(b, 0, 1), false);
});

/* ============================================================
   AI — easy
   ============================================================ */
test('aiRandomShot returns a cell that has not been shot', () => {
  const b = makeBoard(3);
  // Shoot every cell except (1,1)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    if (!(r === 1 && c === 1)) processShot(b, r, c);
  }
  assert.deepEqual(aiRandomShot(b), [1, 1]);
});

test('aiRandomShot returns null when no cells remain', () => {
  const b = makeBoard(2);
  for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) processShot(b, r, c);
  assert.equal(aiRandomShot(b), null);
});

test('easy AI never enters target mode after a hit', () => {
  const ai = makeAI('easy');
  aiUpdateAfterShot(ai, { result: 'hit', r: 0, c: 0, sunk: false }, false);
  assert.equal(ai.mode, 'hunt');
  assert.equal(ai.targetQueue.length, 0);
  assert.equal(ai.hitStack.length, 0);
});

/* ============================================================
   AI — normal (hunt/target)
   ============================================================ */
test('aiChooseShot delegates easy -> random, admiral -> probability, normal -> hunt/target', () => {
  const b = makeBoard(4);
  // Force a predictable choice by draining all cells except one.
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    if (!(r === 2 && c === 2)) processShot(b, r, c);
  }
  assert.deepEqual(aiChooseShot(makeAI('easy'), b, false), [2, 2]);
  assert.deepEqual(aiChooseShot(makeAI('normal'), b, false), [2, 2]);
  assert.deepEqual(aiChooseShot(makeAI('admiral'), b, false), [2, 2]);
});

test('aiHuntTarget in hunt mode picks a checkerboard cell', () => {
  const b = makeBoard(4);
  const ai = makeAI('normal');
  // Force Math.random to 0 so candidates[0] is chosen.
  const pick = withStubbedRandom([0], () => aiHuntTarget(ai, b));
  // (0,0) has (r+c)%2 === 0, so it's the first checkerboard candidate.
  assert.deepEqual(pick, [0, 0]);
});

test('aiUpdateAfterShot on first hit queues 4-neighbor cells', () => {
  const ai = makeAI('normal');
  aiUpdateAfterShot(ai, { result: 'hit', r: 5, c: 5, sunk: false }, /* allowDiag */ false);
  assert.equal(ai.mode, 'target');
  assert.deepEqual(ai.targetQueue.sort(), [[4, 5], [5, 4], [5, 6], [6, 5]].sort());
});

test('aiUpdateAfterShot on first hit with allowDiag queues 8-neighbor cells', () => {
  const ai = makeAI('normal');
  aiUpdateAfterShot(ai, { result: 'hit', r: 5, c: 5, sunk: false }, true);
  assert.equal(ai.targetQueue.length, 8);
});

test('aiUpdateAfterShot on second collinear hit locks onto the line', () => {
  const ai = makeAI('normal');
  aiUpdateAfterShot(ai, { result: 'hit', r: 3, c: 3, sunk: false }, false);
  aiUpdateAfterShot(ai, { result: 'hit', r: 3, c: 4, sunk: false }, false);
  assert.deepEqual(ai.targetQueue, [[3, 5], [3, 2]]);
});

test('aiUpdateAfterShot on sunk clears target/hit state', () => {
  const ai = makeAI('normal');
  const ship = { cells: [[0, 0], [0, 1]], hits: new Set(['0,0', '0,1']) };
  aiUpdateAfterShot(ai, { result: 'hit', r: 0, c: 0, sunk: false }, false);
  aiUpdateAfterShot(ai, { result: 'hit', r: 0, c: 1, sunk: true, ship }, false);
  assert.equal(ai.mode, 'hunt');
  assert.equal(ai.targetQueue.length, 0);
  assert.equal(ai.hitStack.length, 0);
  assert.equal(ai.firstHit, null);
  assert.equal(ai.confirmedDir, null);
});

test('aiUpdateAfterShot ignores misses in hunt mode (no mode change)', () => {
  const ai = makeAI('normal');
  aiUpdateAfterShot(ai, { result: 'miss', r: 0, c: 0 }, false);
  assert.equal(ai.mode, 'hunt');
  assert.equal(ai.targetQueue.length, 0);
  assert.equal(ai.hitStack.length, 0);
});

test('aiHuntTarget drains target queue and skips already-shot / out-of-bounds cells', () => {
  const b = makeBoard(4);
  processShot(b, 0, 1); // stale shot - should be skipped
  const ai = makeAI('normal');
  ai.targetQueue = [[-1, 0], [0, 1], [0, 2]];
  const pick = aiHuntTarget(ai, b);
  assert.deepEqual(pick, [0, 2], 'should skip the OOB and already-shot cells');
});

test('aiHuntTarget resets stale hit state when target queue is exhausted (no firstHit)', () => {
  const b = makeBoard(4);
  const ai = makeAI('normal');
  ai.mode = 'target';
  ai.hitStack = [[0, 0]];
  ai.targetQueue = [];
  aiHuntTarget(ai, b, false);
  assert.equal(ai.hitStack.length, 0, 'stale hit stack should be cleared');
  assert.equal(ai.mode, 'hunt');
});

/* ============================================================
   AI — admiral (probability heatmap)
   ============================================================ */
test('aiProbabilityShot returns a valid in-bounds, unshot cell', () => {
  const b = makeBoard(5);
  placeShip(b, shipDef('cruiser', 3), 0, 0, 'horizontal');
  placeShip(b, shipDef('destroyer', 2), 4, 3, 'horizontal');
  const ai = makeAI('admiral');
  const pick = aiProbabilityShot(ai, b, false);
  assert.ok(Array.isArray(pick));
  const [r, c] = pick;
  assert.ok(cellInBounds(b, r, c));
  assert.equal(b.shotsTaken.has(`${r},${c}`), false);
});

test('aiProbabilityShot prefers the center on an empty board', () => {
  const b = makeBoard(5);
  placeShip(b, shipDef('cruiser', 3), 0, 0, 'horizontal');
  const ai = makeAI('admiral');
  // Stub Math.random to 0 so the first "best" candidate is picked.
  const pick = withStubbedRandom([0], () => aiProbabilityShot(ai, b, false));
  // With one 3-cell ship on a 5-wide board, the center column (c=2) is
  // covered by more placements than any edge cell. The returned pick
  // must be one of the maximum-heat cells.
  const [, c] = pick;
  assert.ok(c >= 1 && c <= 3, `expected center-ish column, got ${c}`);
});

test('aiProbabilityShot drains its target queue before consulting the heatmap', () => {
  const b = makeBoard(5);
  placeShip(b, shipDef('cruiser', 3), 0, 0, 'horizontal');
  const ai = makeAI('admiral');
  ai.targetQueue = [[4, 4]];
  const pick = aiProbabilityShot(ai, b, false);
  assert.deepEqual(pick, [4, 4]);
});

/* ============================================================
   addNeighbors
   ============================================================ */
test('addNeighbors adds 4 cardinal neighbors by default', () => {
  const ai = makeAI('normal');
  addNeighbors(ai, 2, 2, false);
  assert.deepEqual(ai.targetQueue.sort(), [[1, 2], [2, 1], [2, 3], [3, 2]].sort());
});

test('addNeighbors adds 8 neighbors when diagonals are allowed', () => {
  const ai = makeAI('normal');
  addNeighbors(ai, 2, 2, true);
  assert.equal(ai.targetQueue.length, 8);
});

/* ============================================================
   End-to-end: play out a tiny scripted game
   ============================================================ */
test('end-to-end: player can sink a full AI fleet on a 2×2 board', () => {
  const b = makeBoard(2);
  placeShip(b, shipDef('patrol', 1), 0, 0, 'horizontal');
  placeShip(b, shipDef('patrol', 1), 1, 1, 'horizontal');
  assert.equal(allShipsSunk(b), false);

  const missA = processShot(b, 0, 1);
  assert.equal(missA.result, 'miss');
  const missB = processShot(b, 1, 0);
  assert.equal(missB.result, 'miss');
  assert.equal(allShipsSunk(b), false);

  const hit1 = processShot(b, 0, 0);
  assert.equal(hit1.result, 'hit');
  assert.equal(hit1.sunk, true);
  assert.equal(allShipsSunk(b), false, 'one ship left');

  const hit2 = processShot(b, 1, 1);
  assert.equal(hit2.result, 'hit');
  assert.equal(hit2.sunk, true);
  assert.equal(allShipsSunk(b), true);
});

/* ============================================================
   Sink announcements
   ============================================================ */
test('getSinkAnnouncement: player-sinks-enemy uses classic phrasing', () => {
  assert.equal(getSinkAnnouncement('player', 'Battleship'), 'You sank my Battleship!');
  assert.equal(getSinkAnnouncement('player', 'Carrier'), 'You sank my Carrier!');
});

test('getSinkAnnouncement: enemy-sinks-player speaks from the crew POV', () => {
  assert.equal(getSinkAnnouncement('enemy', 'Destroyer'), "We've lost our Destroyer!");
  assert.equal(getSinkAnnouncement('enemy', 'Submarine'), "We've lost our Submarine!");
});

test('getSinkAnnouncement: unknown side returns empty string', () => {
  assert.equal(getSinkAnnouncement('bogus', 'Cruiser'), '');
  assert.equal(getSinkAnnouncement(undefined, 'Cruiser'), '');
});

test('getSinkAnnouncement: missing ship name falls back to generic "ship"', () => {
  assert.equal(getSinkAnnouncement('player', ''), 'You sank my ship!');
  assert.equal(getSinkAnnouncement('enemy', undefined), "We've lost our ship!");
});

/* ============================================================
   AI — improved targeting (BOB-8)
   ============================================================ */

test('makeAI initializes firstHit and confirmedDir to null', () => {
  const ai = makeAI('normal');
  assert.equal(ai.firstHit, null);
  assert.equal(ai.confirmedDir, null);
});

test('aiUpdateAfterShot sets firstHit on initial hit', () => {
  const ai = makeAI('normal');
  aiUpdateAfterShot(ai, { result: 'hit', r: 5, c: 5, sunk: false }, false);
  assert.deepEqual(ai.firstHit, [5, 5]);
  assert.equal(ai.confirmedDir, null);
});

test('aiUpdateAfterShot sets confirmedDir on second collinear hit', () => {
  const ai = makeAI('normal');
  aiUpdateAfterShot(ai, { result: 'hit', r: 3, c: 3, sunk: false }, false);
  aiUpdateAfterShot(ai, { result: 'hit', r: 3, c: 4, sunk: false }, false);
  assert.deepEqual(ai.confirmedDir, [0, 1]);
  assert.deepEqual(ai.firstHit, [3, 3]);
});

test('aiLockDirection computes forward/backward from hit chain endpoints', () => {
  const ai = makeAI('normal');
  ai.firstHit = [3, 3];
  ai.hitStack = [[3, 3], [3, 4], [3, 5]];
  aiLockDirection(ai);
  assert.deepEqual(ai.confirmedDir, [0, 1]);
  assert.deepEqual(ai.targetQueue, [[3, 6], [3, 2]]);
});

test('aiLockDirection handles backward endpoint correctly for 3+ hits', () => {
  const ai = makeAI('normal');
  ai.firstHit = [2, 5];
  ai.hitStack = [[2, 5], [2, 6], [2, 7]];
  aiLockDirection(ai);
  assert.deepEqual(ai.targetQueue, [[2, 8], [2, 4]]);
});

test('miss in target mode with confirmedDir and empty queue triggers perpendicular', () => {
  const ai = makeAI('normal');
  ai.mode = 'target';
  ai.firstHit = [3, 3];
  ai.hitStack = [[3, 3], [3, 4]];
  ai.confirmedDir = [0, 1];
  ai.targetQueue = [];
  aiUpdateAfterShot(ai, { result: 'miss', r: 3, c: 5 }, false);
  // Perpendicular to horizontal = vertical neighbors of firstHit
  assert.deepEqual(ai.targetQueue, [[2, 3], [4, 3]]);
  assert.equal(ai.confirmedDir, null, 'confirmedDir should be cleared for re-detection');
});

test('miss in target mode without confirmedDir does not change queue', () => {
  const ai = makeAI('normal');
  ai.mode = 'target';
  ai.firstHit = [3, 3];
  ai.hitStack = [[3, 3]];
  ai.confirmedDir = null;
  ai.targetQueue = [[2, 3], [4, 3]];
  aiUpdateAfterShot(ai, { result: 'miss', r: 3, c: 4 }, false);
  assert.deepEqual(ai.targetQueue, [[2, 3], [4, 3]], 'queue unchanged without confirmedDir');
});

test('miss in target mode with confirmedDir but non-empty queue does not trigger perpendicular', () => {
  const ai = makeAI('normal');
  ai.mode = 'target';
  ai.firstHit = [3, 3];
  ai.hitStack = [[3, 3], [3, 4]];
  ai.confirmedDir = [0, 1];
  ai.targetQueue = [[3, 2]]; // backward still queued
  aiUpdateAfterShot(ai, { result: 'miss', r: 3, c: 5 }, false);
  assert.deepEqual(ai.targetQueue, [[3, 2]], 'backward should remain in queue');
});

test('aiQueuePerpendicular from horizontal direction queues vertical neighbors', () => {
  const ai = makeAI('normal');
  ai.firstHit = [5, 5];
  ai.confirmedDir = [0, 1];
  aiQueuePerpendicular(ai, false);
  assert.deepEqual(ai.targetQueue, [[4, 5], [6, 5]]);
  assert.equal(ai.confirmedDir, null);
});

test('aiQueuePerpendicular from vertical direction queues horizontal neighbors', () => {
  const ai = makeAI('normal');
  ai.firstHit = [5, 5];
  ai.confirmedDir = [1, 0];
  aiQueuePerpendicular(ai, false);
  assert.deepEqual(ai.targetQueue, [[5, 4], [5, 6]]);
});

test('aiQueuePerpendicular with diagonals queues all non-axis directions', () => {
  const ai = makeAI('normal');
  ai.firstHit = [5, 5];
  ai.confirmedDir = [1, 1]; // diag-down
  aiQueuePerpendicular(ai, true);
  // Should exclude [1,1] and [-1,-1], include the other 6 directions
  assert.equal(ai.targetQueue.length, 6);
  const keys = ai.targetQueue.map(([r, c]) => `${r},${c}`);
  assert.ok(!keys.includes('6,6'), 'should not include forward direction');
  assert.ok(!keys.includes('4,4'), 'should not include reverse direction');
});

test('aiResetToHunt clears all targeting state', () => {
  const ai = makeAI('normal');
  ai.mode = 'target';
  ai.hitStack = [[1, 1]];
  ai.firstHit = [1, 1];
  ai.confirmedDir = [0, 1];
  ai.targetQueue = [[1, 2]];
  aiResetToHunt(ai);
  assert.equal(ai.mode, 'hunt');
  assert.equal(ai.hitStack.length, 0);
  assert.equal(ai.firstHit, null);
  assert.equal(ai.confirmedDir, null);
  assert.equal(ai.targetQueue.length, 0);
});

test('aiHuntTarget tries perpendicular before resetting when queue drains with active firstHit', () => {
  const b = makeBoard(5);
  const ai = makeAI('normal');
  ai.mode = 'target';
  ai.hitStack = [[2, 2]];
  ai.firstHit = [2, 2];
  ai.confirmedDir = [0, 1];
  ai.targetQueue = [];
  // All horizontal neighbors already shot
  processShot(b, 2, 1);
  processShot(b, 2, 3);
  const pick = aiHuntTarget(ai, b, false);
  // Should try perpendicular: (1,2) or (3,2)
  assert.ok(pick !== null);
  const [r, c] = pick;
  assert.equal(c, 2, 'perpendicular shot should be in same column as firstHit');
  assert.ok(r === 1 || r === 3, 'perpendicular shot should be above or below firstHit');
});

test('sunk with adjacent ship hits keeps targeting the adjacent ship', () => {
  const ai = makeAI('normal');
  // Scenario: AI hit a 2-cell ship at (3,3)-(3,4) and accidentally hit
  // an adjacent ship cell at (3,5) while following the line
  aiUpdateAfterShot(ai, { result: 'hit', r: 3, c: 3, sunk: false }, false);
  aiUpdateAfterShot(ai, { result: 'hit', r: 3, c: 4, sunk: false }, false);
  aiUpdateAfterShot(ai, { result: 'hit', r: 3, c: 5, sunk: false }, false);

  // Now the ship at (3,3)-(3,4) is sunk
  const sunkShip = { cells: [[3, 3], [3, 4]], hits: new Set(['3,3', '3,4']) };
  aiUpdateAfterShot(ai, { result: 'hit', r: 3, c: 6, sunk: true, ship: sunkShip }, false);

  // Leftover hit at (3,5) should keep AI in target mode
  assert.equal(ai.mode, 'target');
  assert.equal(ai.hitStack.length, 2, 'should retain (3,5) and (3,6)');
  assert.deepEqual(ai.firstHit, [3, 5]);
  assert.ok(ai.targetQueue.length > 0, 'should have queued neighbors for remaining hit');
});

test('end-to-end: AI follows a line and sinks a horizontal ship', () => {
  const b = makeBoard(6);
  // Place a 4-cell ship at (2,1)-(2,4)
  placeShip(b, shipDef('battleship', 4), 2, 1, 'horizontal');
  const ai = makeAI('normal');

  // Simulate: AI gets a hit at (2,2) from hunt mode
  let shot = processShot(b, 2, 2);
  aiUpdateAfterShot(ai, shot, false);
  assert.equal(ai.mode, 'target');
  assert.deepEqual(ai.firstHit, [2, 2]);

  // AI explores neighbors. Simulate a miss at (1,2) (above)
  shot = processShot(b, 1, 2);
  aiUpdateAfterShot(ai, shot, false);

  // AI tries (3,2) (below) — miss
  shot = processShot(b, 3, 2);
  aiUpdateAfterShot(ai, shot, false);

  // AI tries (2,1) — hit! Direction locked to horizontal
  shot = processShot(b, 2, 1);
  aiUpdateAfterShot(ai, shot, false);
  assert.deepEqual(ai.confirmedDir, [0, -1]);

  // Forward = (2,0) — miss (no ship there)
  shot = processShot(b, 2, 0);
  aiUpdateAfterShot(ai, shot, false);

  // Backward = (2,3) — hit!
  shot = processShot(b, 2, 3);
  aiUpdateAfterShot(ai, shot, false);

  // Continue forward in new direction: (2,4) — hit! Ship sunk!
  shot = processShot(b, 2, 4);
  aiUpdateAfterShot(ai, shot, false);
  assert.equal(shot.sunk, true);
  assert.equal(ai.mode, 'hunt');
  assert.equal(ai.hitStack.length, 0);
});

test('end-to-end: AI reverses direction after miss and completes sinking', () => {
  const b = makeBoard(6);
  // Ship at (3,2)-(3,4)
  placeShip(b, shipDef('cruiser', 3), 3, 2, 'horizontal');
  const ai = makeAI('normal');

  // Hit at (3,3)
  let shot = processShot(b, 3, 3);
  aiUpdateAfterShot(ai, shot, false);

  // Hit at (3,4) — direction locked: [0,1]
  shot = processShot(b, 3, 4);
  aiUpdateAfterShot(ai, shot, false);
  assert.deepEqual(ai.confirmedDir, [0, 1]);

  // Forward (3,5) — miss! Queue still has backward (3,2)
  shot = processShot(b, 3, 5);
  aiUpdateAfterShot(ai, shot, false);
  assert.equal(ai.mode, 'target');

  // Backward (3,2) — hit! Ship sunk!
  shot = processShot(b, 3, 2);
  aiUpdateAfterShot(ai, shot, false);
  assert.equal(shot.sunk, true);
  assert.equal(ai.mode, 'hunt');
});

test('admiral AI clears stale hitStack when target queue drains', () => {
  const b = makeBoard(5);
  placeShip(b, shipDef('cruiser', 3), 0, 0, 'horizontal');
  const ai = makeAI('admiral');
  ai.mode = 'target';
  ai.hitStack = [[2, 2]];
  ai.firstHit = null; // no firstHit → will reset
  ai.targetQueue = [];
  aiProbabilityShot(ai, b, false);
  assert.equal(ai.hitStack.length, 0, 'stale hit stack should be cleared');
  assert.equal(ai.mode, 'hunt');
});
