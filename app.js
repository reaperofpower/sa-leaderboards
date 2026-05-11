const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// ─── Leaderboard Store ────────────────────────────────────────────────────
const MAX_ENTRIES = 10;
const leaderboard = []; // [{ playerName, score, rooms?, submittedAt }]
const allRuns = [];

function addScore(entry) {
  leaderboard.push(entry);
  leaderboard.sort((a, b) => b.score - a.score);
  if (leaderboard.length > MAX_ENTRIES) leaderboard.splice(MAX_ENTRIES);

  allRuns.push(entry);
  allRuns.sort((a, b) => b.score - a.score);
}

// ─── Deterministic PRNG & Game Data (Must match the frontend exactly) ───
const LCG_M = 4294967296;
const LCG_A = 1664525;
const LCG_C = 1013904223;

function nextSeed(seed) { return (seed * LCG_A + LCG_C) % LCG_M; }
function randomFloat(seed) { return seed / LCG_M; }
function hashStringToSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = h << 13 | h >>> 19;
  }
  return h >>> 0;
}

const RANK_VAL = { "2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"10":10,"J":11,"Q":12,"K":13,"A":14 };
const cardValue = (c) => RANK_VAL[c.rank];
const cardType  = (c) => c.suit === "clubs" || c.suit === "spades" ? "monster" : c.suit === "diamonds" ? "weapon" : "potion";
const isBossCard = (c) => c.rank === "A" && cardType(c) === "monster";

function buildDeck() {
  const deck = [];
  for (const suit of ["clubs","spades","hearts","diamonds"]) {
    for (const rank of ["2","3","4","5","6","7","8","9","10","J","Q","K","A"]) {
      if ((suit === "hearts" || suit === "diamonds") && ["J","Q","K","A"].includes(rank)) continue;
      deck.push({ suit, rank, id: `${suit}-${rank}` });
    }
  }
  return deck;
}

function shuffle(arr, startSeed) {
  let currentSeed = startSeed;
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    currentSeed = nextSeed(currentSeed);
    const j = Math.floor(randomFloat(currentSeed) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return { shuffled: a, newSeed: currentSeed };
}

function ensureDungeon(dungeon, curSeed, needed) {
  let d = [...dungeon];
  let seed = curSeed;
  while (d.length < needed) {
    const { shuffled, newSeed } = shuffle(buildDeck(), seed);
    d = [...d, ...shuffled];
    seed = newSeed;
  }
  return { dungeon: d, newSeed: seed };
}

// ─── The Verification Engine ─────────────────────────────────────────────
function verifyRun(seedString, actions, claimedScore) {
  let initialIntSeed = hashStringToSeed(seedString);
  let { shuffled: deck, newSeed: currentSeed } = shuffle(buildDeck(), initialIntSeed);

  let dungeon = deck.slice(4);
  let room    = deck.slice(0, 4);

  let health             = 20;
  let score              = 0;
  let equippedWeapon     = null;
  let weaponLastSlain    = null;
  let potionUsedThisTurn = false;
  let choseThisTurn      = 0;
  let canAvoid           = true;

  // Initialise maxChoices for the starting room (matches frontend endTurnAndDraw formula)
  let maxChoices = dungeon.length === 0
    ? room.length
    : Math.min(3, Math.max(1, room.length - 1));

  for (const action of actions) {
    if (health <= 0) return { valid: false, reason: "Actions continued after death." };

    if (action.choice === "flee") {
      if (!canAvoid) return { valid: false, reason: "Attempted illegal consecutive flee." };

      const monsterTotal = room
        .filter(c => cardType(c) === "monster")
        .reduce((sum, c) => sum + cardValue(c), 0);
      score -= Math.round(monsterTotal * 0.1);

      const full = [...dungeon, ...room];
      const res  = ensureDungeon(full, currentSeed, 4);
      dungeon     = res.dungeon.slice(4);
      room        = res.dungeon.slice(0, 4);
      currentSeed = res.newSeed;

      canAvoid           = false;
      choseThisTurn      = 0;
      potionUsedThisTurn = false;
      // Recalculate maxChoices for the newly drawn room after flee
      maxChoices = dungeon.length === 0
        ? room.length
        : Math.min(3, Math.max(1, room.length - 1));
      continue;
    }

    const cardIdx = room.findIndex(c => c.id === action.cardId);
    if (cardIdx === -1) return { valid: false, reason: `Card ${action.cardId} not in room.` };
    const card = room[cardIdx];
    room.splice(cardIdx, 1);

    const type = cardType(card);
    const val  = cardValue(card);
    const boss = isBossCard(card);

    if (type === "weapon" && action.choice === "equip_weapon") {
      equippedWeapon  = card;
      weaponLastSlain = null;
    } else if (type === "potion" && action.choice === "drink_potion") {
      if (!potionUsedThisTurn) {
        health = Math.min(20, health + val);
        potionUsedThisTurn = true;
      }
    } else if (type === "monster") {
      score += val;
      if (action.choice === "fight_weapon") {
        if (!equippedWeapon || (weaponLastSlain !== null && val > weaponLastSlain)) {
          return { valid: false, reason: "Illegal weapon use." };
        }
        const wv = cardValue(equippedWeapon);
        health -= Math.max(0, val - wv);
        weaponLastSlain = val;
      } else if (action.choice === "fight_barehanded") {
        health -= val;
      } else {
        return { valid: false, reason: "Invalid combat action." };
      }

      if (boss) {
        const res   = shuffle(buildDeck(), currentSeed);
        dungeon     = [...dungeon, ...res.shuffled];
        currentSeed = res.newSeed;
      }
    }

    choseThisTurn++;

    if (choseThisTurn >= maxChoices) {
      const needed = 4 - room.length;
      const res    = ensureDungeon(dungeon, currentSeed, needed > 0 ? needed : 0);
      dungeon      = res.dungeon.slice(needed);
      room         = [...room, ...res.dungeon.slice(0, needed)];
      currentSeed  = res.newSeed;

      if (room.length === 0) {
        const fresh = shuffle(buildDeck(), currentSeed);
        dungeon     = fresh.shuffled.slice(4);
        room        = fresh.shuffled.slice(0, 4);
        currentSeed = fresh.newSeed;
      }

      choseThisTurn      = 0;
      potionUsedThisTurn = false;
      canAvoid           = true;
      // Recalculate maxChoices for the newly formed room
      maxChoices = dungeon.length === 0
        ? room.length
        : Math.min(3, Math.max(1, room.length - 1));
    }
  }

  if (health > 0) return { valid: false, reason: "Run submitted before death." };
  if (score !== claimedScore) return { valid: false, reason: `Score mismatch. Claimed: ${claimedScore}, Calculated: ${score}` };

  return { valid: true, calculatedScore: score };
}

// ─── API Routes ──────────────────────────────────────────────────────────
app.post('/api/submit-score', (req, res) => {
    const { playerName, seed, finalScore, actions } = req.body;
    console.log(`[Replay Pending] Verifying run for ${playerName}...`);

    try {
        const verification = verifyRun(seed, actions, finalScore);

        if (verification.valid) {
            console.log(`[Replay Approved] ${playerName} scored ${verification.calculatedScore}.`);
            addScore({
              playerName,
              score: verification.calculatedScore,
              submittedAt: new Date().toISOString(),
            });
            return res.status(200).json({ success: true, message: "Run verified and accepted!" });
        } else {
            console.warn(`[Replay Failed] ${playerName} rejected: ${verification.reason}`);
            return res.status(403).json({ success: false, message: `Run invalid: ${verification.reason}` });
        }
    } catch (err) {
        console.error("Server error during verification:", err);
        return res.status(500).json({ success: false, message: "Internal server error during replay." });
    }
});

app.get('/api/leaderboard', (req, res) => {
  res.json(leaderboard);
});

app.get('/api/runs', (req, res) => {
  res.json(allRuns);
});

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Scoundrel Leaderboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #0f0f13; color: #e8e8e8; min-height: 100vh; padding: 2rem; }
  h1 { text-align: center; font-size: 2rem; margin-bottom: 0.25rem; letter-spacing: 0.05em; color: #f0c040; }
  .subtitle { text-align: center; color: #888; margin-bottom: 2.5rem; font-size: 0.9rem; }

  /* Podium */
  .podium { display: flex; justify-content: center; align-items: flex-end; gap: 1rem; margin-bottom: 3rem; }
  .podium-slot { display: flex; flex-direction: column; align-items: center; width: 120px; }
  .podium-slot .medal { font-size: 2rem; margin-bottom: 0.4rem; }
  .podium-slot .name { font-size: 0.85rem; font-weight: 600; text-align: center; margin-bottom: 0.3rem; word-break: break-word; }
  .podium-slot .score { font-size: 1.1rem; font-weight: 700; color: #f0c040; margin-bottom: 0.5rem; }
  .podium-block { width: 100%; border-radius: 6px 6px 0 0; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; font-weight: 800; color: rgba(255,255,255,0.2); }
  .podium-slot.first .podium-block { height: 120px; background: linear-gradient(180deg, #b8860b, #6b4e00); }
  .podium-slot.second .podium-block { height: 90px; background: linear-gradient(180deg, #707070, #3a3a3a); }
  .podium-slot.third .podium-block { height: 70px; background: linear-gradient(180deg, #7c5c2e, #3d2e17); }
  .podium-slot .empty-name { color: #555; font-style: italic; }

  /* Search */
  .search-section { max-width: 700px; margin: 0 auto; }
  .search-section h2 { font-size: 1.1rem; color: #aaa; margin-bottom: 0.75rem; }
  #search { width: 100%; padding: 0.6rem 1rem; border-radius: 6px; border: 1px solid #333; background: #1a1a22; color: #e8e8e8; font-size: 1rem; outline: none; margin-bottom: 1rem; }
  #search:focus { border-color: #f0c040; }

  /* Table */
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th { text-align: left; padding: 0.5rem 0.75rem; color: #888; border-bottom: 1px solid #2a2a2a; font-weight: 500; }
  td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #1e1e26; }
  tr:hover td { background: #1a1a22; }
  .rank-cell { color: #f0c040; font-weight: 700; width: 3rem; }
  #no-results { text-align: center; color: #555; padding: 2rem; display: none; }
</style>
</head>
<body>
<h1>Scoundrel</h1>
<p class="subtitle">Global Leaderboard</p>

<div class="podium" id="podium">
  <div class="podium-slot second"><div class="medal">&#129352;</div><div class="name empty-name" id="p2-name">—</div><div class="score" id="p2-score"></div><div class="podium-block">2</div></div>
  <div class="podium-slot first"><div class="medal">&#129351;</div><div class="name empty-name" id="p1-name">—</div><div class="score" id="p1-score"></div><div class="podium-block">1</div></div>
  <div class="podium-slot third"><div class="medal">&#129353;</div><div class="name empty-name" id="p3-name">—</div><div class="score" id="p3-score"></div><div class="podium-block">3</div></div>
</div>

<div class="search-section">
  <h2>All Runs</h2>
  <input id="search" type="text" placeholder="Search player name..." autocomplete="off">
  <table>
    <thead><tr><th class="rank-cell">#</th><th>Player</th><th>Score</th><th>Date</th></tr></thead>
    <tbody id="results"></tbody>
  </table>
  <div id="no-results">No runs found.</div>
</div>

<script>
  let allRuns = [];

  async function loadPodium() {
    try {
      const res = await fetch('/api/leaderboard');
      const top = await res.json();
      const set = (id, val, fallback) => {
        const el = document.getElementById(id);
        if (val !== undefined) { el.textContent = val; el.classList.remove('empty-name'); }
        else { el.textContent = fallback || '—'; }
      };
      set('p1-name', top[0]?.playerName); set('p1-score', top[0] ? top[0].score + ' pts' : '');
      set('p2-name', top[1]?.playerName); set('p2-score', top[1] ? top[1].score + ' pts' : '');
      set('p3-name', top[2]?.playerName); set('p3-score', top[2] ? top[2].score + ' pts' : '');
    } catch(e) { console.error('Failed to load leaderboard', e); }
  }

  async function loadRuns() {
    try {
      const res = await fetch('/api/runs');
      allRuns = await res.json();
      renderTable('');
    } catch(e) { console.error('Failed to load runs', e); }
  }

  function renderTable(query) {
    const q = query.trim().toLowerCase();
    const filtered = q ? allRuns.filter(r => r.playerName.toLowerCase().includes(q)) : allRuns;
    const tbody = document.getElementById('results');
    const noRes = document.getElementById('no-results');
    tbody.innerHTML = '';
    if (filtered.length === 0) { noRes.style.display = 'block'; return; }
    noRes.style.display = 'none';
    filtered.forEach((r, i) => {
      const date = r.submittedAt ? new Date(r.submittedAt).toLocaleDateString() : '—';
      const globalRank = allRuns.indexOf(r) + 1;
      tbody.innerHTML += \`<tr><td class="rank-cell">\${globalRank}</td><td>\${r.playerName}</td><td>\${r.score}</td><td>\${date}</td></tr>\`;
    });
  }

  document.getElementById('search').addEventListener('input', e => renderTable(e.target.value));

  loadPodium();
  loadRuns();
</script>
</body>
</html>`);
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Scoundrel Validation API listening on port ${port}`);
  });
}

function getLeaderboard() { return [...leaderboard]; }
function clearLeaderboard() { leaderboard.splice(0); allRuns.splice(0); }
app.addScore   = addScore;
app.getLeaderboard = getLeaderboard;
app.clearLeaderboard = clearLeaderboard;
function getAllRuns() { return [...allRuns]; }
app.getAllRuns = getAllRuns;

module.exports = app;
