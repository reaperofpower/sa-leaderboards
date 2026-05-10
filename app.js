const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

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
            // TODO: Here is where you will write to Postgres/Redis/MongoDB
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

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Scoundrel Validation API listening on port ${port}`);
});
