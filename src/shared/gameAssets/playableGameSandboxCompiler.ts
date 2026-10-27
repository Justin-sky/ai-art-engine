/**
 * Phase 6 In-App Playable HTML5 Micro-Game Sandbox Compiler.
 *
 * Compiles generated 2D sprites, tilesets, procedural level maps (`generateProceduralLevelMap`),
 * and combat parameters into a self-contained, zero-dependency, immediately playable HTML5 Canvas
 * micro-game supporting both:
 * - `platformer` (Side-scrolling platformer with gravity, coyote jump, coins, enemies, boss portal)
 * - `survivor` (Top-down 360-degree roguelike survivor with auto-aim projectiles, enemy waves, XP gems, critical damage numbers)
 */

import {
  generateProceduralLevelMap,
  type LevelGeneratorAlgorithm,
  type ProceduralLevelMapResult
} from './proceduralLevelMap'

export type PlayableSandboxMode =
  'platformer' | 'survivor' | 'tower_defense' | 'card_dbg' | 'avg_dialogue'

export interface PlayableSandboxCardSpec {
  id: string
  name: string
  cost: number
  cardType: string
  damage: number
  block: number
  description?: string
}

export interface PlayableSandboxDialogueNode {
  id: string
  speaker: string
  portraitEmotion?: string
  text: string
  choices?: Array<{
    label: string
    nextId: string
    effect?: string
  }>
}

export interface PlayableGameTuningOptions {
  /** 主角移速倍率（0.4~2.5，默认 1.0） */
  moveSpeedScale?: number
  /** 跳跃/冲刺力度倍率（0.4~2.5，默认 1.0） */
  jumpDashScale?: number
  /** 怪物移速与刷怪频率倍率（0.4~2.5，默认 1.0） */
  enemyAggroScale?: number
  /** 受击与暴击震屏强度倍率（0~2.0，默认 1.0） */
  screenShakeScale?: number
  /** 全局时间缩放 / 子弹时间（0.25~1.5，默认 1.0） */
  timeScale?: number
  /** 是否显示碰撞判定框、瞄准射线与实时帧率遥测叠层 */
  showDebugHitboxes?: boolean
}

export interface PlayableGameSandboxOptions extends PlayableGameTuningOptions {
  title?: string
  mode?: PlayableSandboxMode
  genre?: string
  cameraMode?: string
  levelSeed?: number
  playerSpriteDataUrl?: string
  enemySpriteDataUrl?: string
  tileSpriteDataUrl?: string
  bgmDataUrl?: string
  sfxDataUrl?: string
  levelMap?: ProceduralLevelMapResult
  customPlayerMaxHp?: number
  customPlayerBaseAtk?: number
  customCards?: PlayableSandboxCardSpec[]
  customDialogues?: PlayableSandboxDialogueNode[]
}

export interface CompiledPlayableSandboxResult {
  title: string
  mode: PlayableSandboxMode
  levelAlgorithm: LevelGeneratorAlgorithm
  html: string
}

export function compilePlayableGameSandboxHtml(
  options: PlayableGameSandboxOptions = {}
): CompiledPlayableSandboxResult {
  const title = (options.title || 'AI Art Engine Playable Sandbox').trim()
  const inferredMode: PlayableSandboxMode =
    options.mode ??
    (options.genre === 'tower_defense'
      ? 'tower_defense'
      : options.genre === 'card_dbg'
        ? 'card_dbg'
        : options.genre === 'avg_dialogue'
          ? 'avg_dialogue'
          : options.cameraMode === 'side_scroller' || options.genre === 'metroidvania_platformer'
            ? 'platformer'
            : 'survivor')
  const mode: PlayableSandboxMode = inferredMode
  const levelAlgorithm: LevelGeneratorAlgorithm =
    mode === 'platformer'
      ? 'platformer_course'
      : mode === 'tower_defense'
        ? 'tower_defense'
        : 'arena_waves'

  const level =
    options.levelMap ??
    generateProceduralLevelMap({
      levelName: 'sandbox_stage',
      algorithm: levelAlgorithm,
      width: 32,
      height: 20,
      tileWidth: 32,
      tileHeight: 32,
      seed: options.levelSeed ?? 42
    })

  const configPayload = JSON.stringify({
    title,
    initialMode: mode,
    playerImg: options.playerSpriteDataUrl || '',
    enemyImg: options.enemySpriteDataUrl || '',
    tileImg: options.tileSpriteDataUrl || '',
    bgmUrl: options.bgmDataUrl || '',
    sfxUrl: options.sfxDataUrl || '',
    customPlayerMaxHp: Number(options.customPlayerMaxHp ?? 100),
    customPlayerBaseAtk: Number(options.customPlayerBaseAtk ?? 14),
    customCards: Array.isArray(options.customCards) ? options.customCards : [],
    customDialogues: Array.isArray(options.customDialogues) ? options.customDialogues : [],
    tuning: {
      moveSpeedScale: Number(options.moveSpeedScale ?? 1.0),
      jumpDashScale: Number(options.jumpDashScale ?? 1.0),
      enemyAggroScale: Number(options.enemyAggroScale ?? 1.0),
      screenShakeScale: Number(options.screenShakeScale ?? 1.0),
      timeScale: Number(options.timeScale ?? 1.0),
      showDebugHitboxes: Boolean(options.showDebugHitboxes)
    },
    level: {
      width: level.width,
      height: level.height,
      tileWidth: level.tileWidth,
      tileHeight: level.tileHeight,
      grid: level.grid,
      entities: level.entities
    }
  })

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title.replace(/</g, '&lt;')}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
  body {
    background: #080d18;
    color: #e6f1ff;
    font-family: system-ui, -apple-system, sans-serif;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    padding: 8px 12px;
    gap: 6px;
    height: 100vh;
    overflow: hidden;
  }
  .hud-bar {
    width: min(960px, 98vw);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 6px 8px;
    padding: 6px 12px;
    background: rgba(14, 23, 38, 0.94);
    border: 1px solid rgba(56, 189, 248, 0.35);
    border-radius: 8px;
    flex-shrink: 0;
    font-size: 12px;
  }
  .hud-stats,
  .hud-modes {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .mode-btn {
    background: #13233a;
    color: #7dd3fc;
    border: 1px solid rgba(56, 189, 248, 0.4);
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 12px;
    cursor: pointer;
    font-weight: 600;
    white-space: nowrap;
  }
  .mode-btn.active {
    background: #0284c7;
    color: #fff;
  }
  .stage-wrap {
    position: relative;
    flex: 1;
    min-height: 0;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  canvas {
    border: 2px solid rgba(56, 189, 248, 0.45);
    border-radius: 10px;
    background: #0c1424;
    box-shadow: 0 10px 32px rgba(0, 0, 0, 0.6);
    max-width: min(960px, 98vw);
    max-height: 100%;
    width: auto;
    height: auto;
    aspect-ratio: 16 / 10;
  }
  .perk-modal {
    position: absolute;
    inset: 0;
    background: rgba(8, 13, 24, 0.82);
    backdrop-filter: blur(4px);
    display: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    border-radius: 10px;
    z-index: 10;
  }
  .perk-modal.open {
    display: flex;
  }
  .perk-title {
    font-size: 20px;
    font-weight: 800;
    color: #fde047;
    text-shadow: 0 2px 10px rgba(253, 224, 71, 0.4);
  }
  .perk-cards {
    display: flex;
    gap: 14px;
    padding: 0 16px;
  }
  .perk-card {
    width: 210px;
    padding: 14px;
    border-radius: 10px;
    background: linear-gradient(180deg, #162642 0%, #0f172a 100%);
    border: 1px solid rgba(56, 189, 248, 0.5);
    color: #f8fafc;
    cursor: pointer;
    text-align: left;
    transition: transform 0.12s ease, border-color 0.12s ease;
  }
  .perk-card:hover {
    transform: translateY(-4px);
    border-color: #fde047;
  }
  .perk-card h4 {
    font-size: 14px;
    color: #38bdf8;
    margin-bottom: 6px;
  }
  .perk-card p {
    font-size: 12px;
    color: #cbd5e1;
    line-height: 1.4;
  }
</style>
</head>
<body>
  <div class="hud-bar">
    <div class="hud-stats">
      <strong id="gameTitle"></strong>
      <span>Lv.<b id="lvVal">1</b></span>
      <span>HP: <b id="hpVal">100</b></span>
      <span>XP: <b id="scoreVal">0</b>/<b id="xpNextVal">50</b></span>
      <span>Gold: <b id="goldVal">120</b></span>
      <span>Kills: <b id="killsVal">0</b></span>
    </div>
    <div class="hud-modes">
      <button id="btnSurvivor" class="mode-btn" title="Survivor Mode (WASD + Space Dash + Auto-Fire)">⚔️ Survivor</button>
      <button id="btnPlatformer" class="mode-btn" title="Platformer Mode (A/D + Space Jump + Click Shoot)">🏃 Platformer</button>
      <button id="btnTowerDefense" class="mode-btn" title="Tower Defense Mode (Click Map to Build/Upgrade Turrets 40G)">🗼 Tower Defense</button>
      <button id="btnCardDbg" class="mode-btn" title="Card Battle Mode (Click Hand Cards + Keys 1-4)">🃏 Card Battle</button>
      <button id="btnAvgDialogue" class="mode-btn" title="AVG Story Mode (Click Choices + Keys 1-2)">💬 AVG Story</button>
      <button id="btnAudio" class="mode-btn active">🔊 SFX</button>
    </div>
  </div>
  <div class="stage-wrap">
    <canvas id="stage" width="960" height="600"></canvas>
    <div id="perkModal" class="perk-modal">
      <div class="perk-title">✨ LEVEL UP! Choose a Roguelike Upgrade (Keys 1 / 2 / 3)</div>
      <div id="perkCards" class="perk-cards"></div>
    </div>
  </div>
<script>
const CFG = ${configPayload};
document.getElementById('gameTitle').textContent = CFG.title;

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
let mode = CFG.initialMode || 'survivor';
const tuning = Object.assign({
  moveSpeedScale: 1.0,
  jumpDashScale: 1.0,
  enemyAggroScale: 1.0,
  screenShakeScale: 1.0,
  timeScale: 1.0,
  showDebugHitboxes: false
}, CFG.tuning || {});

window.addEventListener('message', (ev) => {
  if (ev && ev.data && ev.data.type === 'aiart:playable-tune' && ev.data.payload) {
    Object.assign(tuning, ev.data.payload);
  } else if (ev && ev.data && ev.data.type === 'aiart:playable-data' && ev.data.payload) {
    const p = ev.data.payload;
    if (typeof p.customPlayerMaxHp === 'number' && p.customPlayerMaxHp > 0) {
      player.maxHp = p.customPlayerMaxHp;
      player.hp = Math.min(player.hp, player.maxHp);
      document.getElementById('hpVal').textContent = String(player.hp);
    }
    if (typeof p.customPlayerBaseAtk === 'number' && p.customPlayerBaseAtk > 0) {
      perks.dmgScale = p.customPlayerBaseAtk / 14;
    }
    if (Array.isArray(p.customCards) && p.customCards.length > 0) {
      cardPool = p.customCards;
      if (mode === 'card_dbg') drawNewHand();
    }
    if (Array.isArray(p.customDialogues) && p.customDialogues.length > 0) {
      avgDialogues = p.customDialogues;
    }
  }
});

// Zero-config WebAudio procedural SFX + upstream WAV playback
let audioEnabled = true;
let audioCtx = null;
const upstreamSfxAudio = CFG.sfxUrl ? new Audio(CFG.sfxUrl) : null;
const upstreamBgmAudio = CFG.bgmUrl ? new Audio(CFG.bgmUrl) : null;
if (upstreamBgmAudio) {
  upstreamBgmAudio.loop = true;
  upstreamBgmAudio.volume = 0.35;
}

function playSynthSfx(kind) {
  if (!audioEnabled) return;
  if ((kind === 'shoot' || kind === 'hit') && upstreamSfxAudio) {
    try {
      upstreamSfxAudio.currentTime = 0;
      upstreamSfxAudio.volume = 0.45;
      upstreamSfxAudio.play().catch(() => {});
      return;
    } catch {}
  }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    if (kind === 'shoot') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(580, now);
      osc.frequency.exponentialRampToValueAtTime(160, now + 0.08);
      gain.gain.setValueAtTime(0.11, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    } else if (kind === 'hit') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(210, now);
      osc.frequency.exponentialRampToValueAtTime(75, now + 0.07);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
      osc.start(now);
      osc.stop(now + 0.07);
    } else if (kind === 'pickup') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1174.66, now + 0.045);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
      osc.start(now);
      osc.stop(now + 0.11);
    } else if (kind === 'levelup') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.07);
      osc.frequency.setValueAtTime(783.99, now + 0.14);
      osc.frequency.setValueAtTime(1046.5, now + 0.21);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
      osc.start(now);
      osc.stop(now + 0.36);
    } else if (kind === 'jump') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(540, now + 0.11);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
      osc.start(now);
      osc.stop(now + 0.11);
    }
  } catch {}
}

document.getElementById('btnAudio').onclick = () => {
  audioEnabled = !audioEnabled;
  const btn = document.getElementById('btnAudio');
  btn.classList.toggle('active', audioEnabled);
  btn.textContent = audioEnabled ? '🔊 SFX' : '🔇 Mute';
  if (upstreamBgmAudio) {
    if (audioEnabled) upstreamBgmAudio.play().catch(() => {});
    else upstreamBgmAudio.pause();
  }
};

const loadOptImage = (src) => {
  if (!src) return null;
  const img = new Image();
  img.src = src;
  return img;
};
const playerSprite = loadOptImage(CFG.playerImg);
const enemySprite = loadOptImage(CFG.enemyImg);
const tileSprite = loadOptImage(CFG.tileImg);

// Parse level grid & interactive entities
const lvlW = Math.max(8, Number((CFG.level && CFG.level.width) || 32));
const lvlH = Math.max(8, Number((CFG.level && CFG.level.height) || 20));
const cellW = canvas.width / lvlW;
const cellH = canvas.height / lvlH;
const lvlGrid = (CFG.level && Array.isArray(CFG.level.grid)) ? CFG.level.grid : [];
const lvlEntities = (CFG.level && Array.isArray(CFG.level.entities)) ? CFG.level.entities : [];

function getCellAtPx(px, py) {
  const gx = Math.floor(px / cellW);
  const gy = Math.floor(py / cellH);
  if (gx <= 0 || gx >= lvlW - 1 || gy <= 0 || gy >= lvlH - 1) return 'border';
  return (lvlGrid[gy] && lvlGrid[gy][gx]) || 'floor';
}

function isSolidWallAtPx(px, py) {
  const gx = Math.floor(px / cellW);
  const gy = Math.floor(py / cellH);
  if (gx < 1 || gx >= lvlW - 1 || gy < 1 || gy >= lvlH - 1) return true;
  // Keep central spawn corridor clear so player never gets trapped
  if (Math.hypot(px - 480, py - 300) < 64) return false;
  const cell = (lvlGrid[gy] && lvlGrid[gy][gx]) || 'floor';
  return cell === 'wall';
}

const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (upgradeOpen) {
    if (e.code === 'Digit1') applyPerk(0);
    else if (e.code === 'Digit2') applyPerk(1);
    else if (e.code === 'Digit3') applyPerk(2);
    return;
  }
  if (mode === 'card_dbg') {
    if (e.code === 'Digit1') playCardAtIndex(0);
    else if (e.code === 'Digit2') playCardAtIndex(1);
    else if (e.code === 'Digit3') playCardAtIndex(2);
    else if (e.code === 'Digit4') playCardAtIndex(3);
    else if (e.code === 'KeyE') endCardTurn();
  } else if (mode === 'avg_dialogue') {
    if (e.code === 'Digit1') selectAvgChoice(0);
    else if (e.code === 'Digit2') selectAvgChoice(1);
  }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

const baseMaxHp = Math.max(20, Number(CFG.customPlayerMaxHp || 100));
const basePlayerAtk = Math.max(4, Number(CFG.customPlayerBaseAtk || 14));
const player = { x: 480, y: 300, vx: 0, vy: 0, hp: baseMaxHp, maxHp: baseMaxHp, facing: 1, flash: 0, grounded: false, dashCd: 0 };
const perks = { multiShot: 1, critBonus: 0, dmgScale: basePlayerAtk / 14, fireRateScale: 1.0, moveBonus: 1.0, lifesteal: 0 };
let playerLevel = 1;
let xp = 0;
let xpNext = 50;
let gold = 120;
let upgradeOpen = false;
let activePerkChoices = [];
let chests = [];
let turrets = [];
let portal = { x: 840, y: 120 };
let bullets = [];
let enemies = [];
let gems = [];
let popups = [];
let particles = [];
let kills = 0;
let fireTimer = 0;
let spawnTimer = 0;
let shakeTrauma = 0;
let lastFrameTime = performance.now();
let fpsSmooth = 60;

// Deckbuilder Card Mode State
const DEFAULT_CARD_POOL = [
  { id: 'c_strike', name: 'Overcharge Strike', cost: 1, cardType: 'attack', damage: 16, block: 0, description: 'Deal 16 DMG to Boss' },
  { id: 'c_aegis', name: 'Aegis Bulwark', cost: 1, cardType: 'skill', damage: 0, block: 14, description: 'Gain +14 Shield Block' },
  { id: 'c_nova', name: 'Void Supernova', cost: 2, cardType: 'attack', damage: 32, block: 6, description: 'Deal 32 DMG & +6 Block' },
  { id: 'c_siphon', name: 'Soul Siphon', cost: 1, cardType: 'skill', damage: 12, block: 8, description: 'Deal 12 DMG & +8 Block' }
];
let cardPool = (Array.isArray(CFG.customCards) && CFG.customCards.length > 0) ? CFG.customCards : DEFAULT_CARD_POOL;
let handCards = [];
let cardEnergy = 3;
let cardMaxEnergy = 3;
let cardBlock = 0;
let cardTurn = 1;
let bossHp = 140;
let bossMaxHp = 140;
let bossIntentDmg = 14;
let bossStage = 1;

function drawNewHand() {
  handCards = [];
  for (let i = 0; i < 4; i++) {
    const template = cardPool[i % cardPool.length] || DEFAULT_CARD_POOL[i % DEFAULT_CARD_POOL.length];
    handCards.push(Object.assign({}, template, { played: false }));
  }
}

function playCardAtIndex(idx) {
  if (mode !== 'card_dbg') return;
  const c = handCards[idx];
  if (!c || c.played) return;
  const cost = Math.max(0, Number(c.cost ?? 1));
  if (cardEnergy < cost) {
    spawnPopup(240 + idx * 165, 420, 'NO ENERGY!', '#f43f5e', false);
    return;
  }
  cardEnergy -= cost;
  c.played = true;
  const dmg = Math.round(Number(c.damage || 0) * perks.dmgScale);
  const blk = Math.round(Number(c.block || 0));
  if (blk > 0) {
    cardBlock += blk;
    playSynthSfx('pickup');
    spawnHitParticles(230, 260, '#38bdf8', 12);
    spawnPopup(230, 210, '+' + blk + ' BLOCK', '#38bdf8', true);
  }
  if (dmg > 0) {
    bossHp = Math.max(0, bossHp - dmg);
    playSynthSfx('hit');
    addShake(7.0);
    spawnHitParticles(720, 250, '#fbbf24', 16);
    spawnPopup(720, 195, '-' + dmg + ' (' + c.name + ')', '#fbbf24', true);
    if (bossHp <= 0) {
      kills += 1;
      gold += 45;
      document.getElementById('killsVal').textContent = String(kills);
      document.getElementById('goldVal').textContent = String(gold);
      gainXp(40);
      bossStage += 1;
      bossMaxHp = Math.round(bossMaxHp * 1.35);
      bossHp = bossMaxHp;
      bossIntentDmg = 12 + bossStage * 4;
      spawnPopup(720, 150, 'BOSS DEFEATED! STAGE ' + bossStage, '#4ade80', true);
    }
  }
}

function endCardTurn() {
  if (mode !== 'card_dbg') return;
  const incoming = Math.max(0, bossIntentDmg - cardBlock);
  const blocked = Math.min(bossIntentDmg, cardBlock);
  cardBlock = 0;
  if (blocked > 0) {
    spawnPopup(230, 230, 'BLOCKED ' + blocked, '#38bdf8', false);
  }
  if (incoming > 0) {
    player.hp = Math.max(1, player.hp - incoming);
    document.getElementById('hpVal').textContent = String(player.hp);
    addShake(8.0);
    playSynthSfx('hit');
    spawnPopup(230, 195, '-' + incoming + ' BOSS HIT', '#f43f5e', true);
  }
  cardTurn += 1;
  cardEnergy = cardMaxEnergy;
  bossIntentDmg = 10 + ((cardTurn * 5) % 14);
  drawNewHand();
}

// AVG Visual Novel Story State
const DEFAULT_DIALOGUES = [
  {
    id: 'dlg_intro_01',
    speaker: 'Astra (Valkyrie Commander)',
    portraitEmotion: 'determined',
    text: 'The Obsidian Rift is destabilizing! Which tactical protocol shall we execute before the Abyssal Warden awakens?',
    choices: [
      { label: '[Overcharge Core] Divert shield power to Astra Blade (+ATK / Affinity +15)', nextId: 'dlg_branch_atk', effect: '+15 Affinity | +25% Blade Damage' },
      { label: '[Sanctuary Ward] Fortify ancient runes & rescue scouts (+HP / Affinity +20)', nextId: 'dlg_branch_def', effect: '+20 Affinity | Restore Full HP' }
    ]
  },
  {
    id: 'dlg_branch_atk',
    speaker: 'Astra (Valkyrie Commander)',
    portraitEmotion: 'smiling',
    text: 'Bold choice! Crimson lightning surges through the blade. Let us cleave straight through the Warden heart!',
    choices: [
      { label: '[Launch Final Assault] Enter Boss Sanctum (+30 XP)', nextId: 'dlg_finale', effect: 'Flag: Crimson_Assault_Route' },
      { label: '[Re-evaluate Strategy] Return to Rift Command', nextId: 'dlg_intro_01', effect: 'Loop Tactical Briefing' }
    ]
  },
  {
    id: 'dlg_branch_def',
    speaker: 'Astra (Valkyrie Commander)',
    portraitEmotion: 'surprised',
    text: 'The trapped scouts are safe inside the Aegis barrier! They shared secret coordinates to the Warden weak point.',
    choices: [
      { label: '[Strike Weak Point] Trigger Sanctuary Counterattack (+30 XP)', nextId: 'dlg_finale', effect: 'Flag: Aegis_Savior_Route' },
      { label: '[Re-evaluate Strategy] Return to Rift Command', nextId: 'dlg_intro_01', effect: 'Loop Tactical Briefing' }
    ]
  },
  {
    id: 'dlg_finale',
    speaker: 'Abyssal Warden & Astra',
    portraitEmotion: 'determined',
    text: 'With your command, the Obsidian Rift is sealed! You can switch to Survivor / Card Battle at any time with your buffs active.',
    choices: [
      { label: '[Replay Story Chapter] Start New Timeline Branch', nextId: 'dlg_intro_01', effect: '+20 Gold Bonus' },
      { label: '[Switch to Card Battle] Challenge Boss in Deckbuilder Mode', nextId: '__switch_card__', effect: 'Enter Card Battle' }
    ]
  }
];
let avgDialogues = (Array.isArray(CFG.customDialogues) && CFG.customDialogues.length > 0) ? CFG.customDialogues : DEFAULT_DIALOGUES;
let avgCurrentId = (avgDialogues[0] && avgDialogues[0].id) || 'dlg_intro_01';
let avgCharIndex = 0;
let avgAffinity = 25;
let avgRouteFlag = 'Prologue_Active';

function getCurrentAvgNode() {
  return avgDialogues.find((d) => d.id === avgCurrentId) || avgDialogues[0] || DEFAULT_DIALOGUES[0];
}

function selectAvgChoice(idx) {
  if (mode !== 'avg_dialogue') return;
  const node = getCurrentAvgNode();
  const choices = (node && Array.isArray(node.choices)) ? node.choices : [];
  const chosen = choices[idx];
  if (!chosen) return;
  playSynthSfx('pickup');
  avgAffinity += 15;
  if (chosen.effect) {
    avgRouteFlag = chosen.effect;
    spawnPopup(480, 320, chosen.effect, '#fde047', true);
  }
  if (chosen.nextId === '__switch_card__') {
    setMode('card_dbg');
    return;
  }
  avgCurrentId = chosen.nextId || (avgDialogues[0] && avgDialogues[0].id) || 'dlg_intro_01';
  avgCharIndex = 0;
}

const PERK_POOL = [
  { id: 'multishot', title: '⚡ Multi-Shot +1', desc: 'Fire +1 extra fan projectile per attack', apply: () => { perks.multiShot += 1; } },
  { id: 'vampiric', title: '🩸 Vampiric Blade', desc: 'Heal 30 HP now and restore +3 HP per kill', apply: () => { player.hp = Math.min(player.maxHp, player.hp + 30); perks.lifesteal += 3; document.getElementById('hpVal').textContent = String(player.hp); } },
  { id: 'crit', title: '🌩️ Crit Overdrive', desc: '+20% Crit Chance and +30% Base Bullet Damage', apply: () => { perks.critBonus += 0.2; perks.dmgScale *= 1.3; } },
  { id: 'haste', title: '👟 Phantom Haste', desc: '+18% Move Speed and +25% Auto-Fire Rate', apply: () => { perks.moveBonus *= 1.18; perks.fireRateScale *= 1.25; } }
];

function openUpgradeModal() {
  upgradeOpen = true;
  playSynthSfx('levelup');
  activePerkChoices = PERK_POOL.slice(0, 3);
  const container = document.getElementById('perkCards');
  container.innerHTML = '';
  activePerkChoices.forEach((p, idx) => {
    const card = document.createElement('button');
    card.className = 'perk-card';
    card.innerHTML = '<h4>[' + (idx + 1) + '] ' + p.title + '</h4><p>' + p.desc + '</p>';
    card.onclick = () => applyPerk(idx);
    container.appendChild(card);
  });
  document.getElementById('perkModal').classList.add('open');
}

function applyPerk(idx) {
  const chosen = activePerkChoices[idx];
  if (!chosen) return;
  chosen.apply();
  upgradeOpen = false;
  document.getElementById('perkModal').classList.remove('open');
  spawnPopup(player.x, player.y - 36, 'UPGRADE: ' + chosen.title.split(' ')[1], '#fde047', true);
}

function gainXp(amount) {
  xp += amount;
  while (xp >= xpNext) {
    xp -= xpNext;
    playerLevel += 1;
    xpNext = Math.round(xpNext * 1.45);
    document.getElementById('lvVal').textContent = String(playerLevel);
    document.getElementById('xpNextVal').textContent = String(xpNext);
    openUpgradeModal();
  }
  document.getElementById('scoreVal').textContent = String(xp);
}

function addShake(amount) {
  shakeTrauma = Math.min(18, shakeTrauma + amount * (tuning.screenShakeScale ?? 1));
}

function initLevelEntities() {
  chests = [];
  turrets = [];
  const sp = lvlEntities.find((e) => e.type === 'player_spawn');
  const ep = lvlEntities.find((e) => e.type === 'exit_portal' || e.type === 'boss_spawn');
  portal = ep ? { x: (ep.gridX + 0.5) * cellW, y: (ep.gridY + 0.5) * cellH } : { x: canvas.width - 96, y: 96 };
  for (const e of lvlEntities) {
    if (e.type === 'treasure_chest' || e.type === 'coin') {
      chests.push({ x: (e.gridX + 0.5) * cellW, y: (e.gridY + 0.5) * cellH });
    }
  }
  if (chests.length === 0) {
    chests.push({ x: 200, y: 160 }, { x: 760, y: 440 });
  }
  if (mode === 'tower_defense') {
    turrets.push(
      { x: 320, y: 220, cd: 0, range: 185, level: 1, aim: 0 },
      { x: 610, y: 360, cd: 10, range: 185, level: 1, aim: 0 }
    );
    player.x = portal.x - 40;
    player.y = portal.y;
  } else if (sp && mode === 'survivor') {
    player.x = Math.max(48, Math.min(canvas.width - 48, (sp.gridX + 0.5) * cellW));
    player.y = Math.max(48, Math.min(canvas.height - 48, (sp.gridY + 0.5) * cellH));
  } else {
    player.x = 480;
    player.y = mode === 'platformer' ? 380 : 300;
  }
}

function setMode(nextMode) {
  mode = nextMode;
  document.getElementById('btnSurvivor').classList.toggle('active', mode === 'survivor');
  document.getElementById('btnPlatformer').classList.toggle('active', mode === 'platformer');
  const tdBtn = document.getElementById('btnTowerDefense');
  if (tdBtn) tdBtn.classList.toggle('active', mode === 'tower_defense');
  const cardBtn = document.getElementById('btnCardDbg');
  if (cardBtn) cardBtn.classList.toggle('active', mode === 'card_dbg');
  const avgBtn = document.getElementById('btnAvgDialogue');
  if (avgBtn) avgBtn.classList.toggle('active', mode === 'avg_dialogue');
  player.vx = 0;
  player.vy = 0;
  player.hp = player.maxHp;
  document.getElementById('hpVal').textContent = String(player.hp);
  gold = 120;
  const goldEl = document.getElementById('goldVal');
  if (goldEl) goldEl.textContent = String(gold);
  bullets = [];
  enemies = [];
  gems = [];
  popups = [];
  particles = [];
  if (mode === 'card_dbg') {
    cardEnergy = cardMaxEnergy;
    cardBlock = 0;
    drawNewHand();
  } else if (mode === 'avg_dialogue') {
    avgCharIndex = 0;
  }
  initLevelEntities();
}

document.getElementById('btnSurvivor').onclick = () => setMode('survivor');
document.getElementById('btnPlatformer').onclick = () => setMode('platformer');
if (document.getElementById('btnTowerDefense')) {
  document.getElementById('btnTowerDefense').onclick = () => setMode('tower_defense');
}
if (document.getElementById('btnCardDbg')) {
  document.getElementById('btnCardDbg').onclick = () => setMode('card_dbg');
}
if (document.getElementById('btnAvgDialogue')) {
  document.getElementById('btnAvgDialogue').onclick = () => setMode('avg_dialogue');
}
setMode(mode);

function spawnPopup(x, y, text, color, isCrit) {
  popups.push({ x, y, vy: -1.8, text, color: color || '#fde047', life: 45, isCrit: !!isCrit });
}

function spawnHitParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 1.5 + Math.random() * 4.2;
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, color, life: 16 + Math.floor(Math.random() * 12) });
  }
}

function fireProjectilesAt(ang, originX, originY) {
  const ox = originX !== undefined ? originX : player.x;
  const oy = originY !== undefined ? originY : player.y;
  const count = perks.multiShot;
  const spread = 0.16;
  for (let i = 0; i < count; i++) {
    const offset = (i - (count - 1) / 2) * spread;
    const a = ang + offset;
    bullets.push({ x: ox, y: oy, vx: Math.cos(a) * 9.2, vy: Math.sin(a) * 9.2, life: 75 });
  }
  playSynthSfx('shoot');
}

canvas.addEventListener('pointerdown', (e) => {
  if (upgradeOpen) return;
  if (upstreamBgmAudio && audioEnabled && upstreamBgmAudio.paused) {
    upstreamBgmAudio.play().catch(() => {});
  }
  const rect = canvas.getBoundingClientRect();
  const tx = ((e.clientX - rect.left) / rect.width) * canvas.width;
  const ty = ((e.clientY - rect.top) / rect.height) * canvas.height;
  if (mode === 'card_dbg') {
    // Check End Turn button click (x: 800..930, y: 460..520)
    if (tx >= 790 && tx <= 935 && ty >= 450 && ty <= 530) {
      endCardTurn();
      return;
    }
    // Check 4 Hand Cards (x: 90 + i * 170, y: 395..575, width: 155)
    for (let i = 0; i < handCards.length; i++) {
      const cx = 90 + i * 170;
      if (tx >= cx && tx <= cx + 155 && ty >= 395 && ty <= 575) {
        playCardAtIndex(i);
        return;
      }
    }
    return;
  }
  if (mode === 'avg_dialogue') {
    const node = getCurrentAvgNode();
    const choices = (node && Array.isArray(node.choices)) ? node.choices : [];
    for (let i = 0; i < choices.length; i++) {
      const cy = 485 + i * 44;
      if (tx >= 80 && tx <= 880 && ty >= cy && ty <= cy + 36) {
        selectAvgChoice(i);
        return;
      }
    }
    avgCharIndex = 9999;
    return;
  }
  if (mode === 'tower_defense') {
    const existing = turrets.find((t) => Math.hypot(t.x - tx, t.y - ty) < 28);
    if (existing && gold >= 40) {
      gold -= 40;
      existing.level += 1;
      existing.range += 22;
      document.getElementById('goldVal').textContent = String(gold);
      playSynthSfx('pickup');
      spawnPopup(existing.x, existing.y - 24, 'TURRET Lv.' + existing.level + '!', '#4ade80', true);
      return;
    }
    if (gold >= 40) {
      gold -= 40;
      turrets.push({ x: tx, y: ty, cd: 0, range: 185, level: 1, aim: 0 });
      document.getElementById('goldVal').textContent = String(gold);
      playSynthSfx('pickup');
      spawnHitParticles(tx, ty, '#38bdf8', 10);
      spawnPopup(tx, ty - 22, 'TURRET BUILT (-40G)', '#38bdf8', true);
      return;
    }
  }
  const ang = Math.atan2(ty - player.y, tx - player.x);
  fireProjectilesAt(ang);
});

function update() {
  if (upgradeOpen) return;
  const dt = Math.max(0.2, Math.min(1.8, Number(tuning.timeScale ?? 1.0)));
  if (shakeTrauma > 0) shakeTrauma = Math.max(0, shakeTrauma - 0.85 * dt);
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.life -= dt;
    if (pt.life <= 0) particles.splice(i, 1);
  }
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i];
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) popups.splice(i, 1);
  }
  if (mode === 'card_dbg') {
    return;
  }
  if (mode === 'avg_dialogue') {
    avgCharIndex = Math.min(9999, avgCharIndex + 1.4 * dt);
    return;
  }
  const moveSpd = Number(tuning.moveSpeedScale ?? 1.0) * perks.moveBonus * dt;
  const jumpSpd = Number(tuning.jumpDashScale ?? 1.0);
  const aggro = Number(tuning.enemyAggroScale ?? 1.0) * dt;

  const moveX = (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0) - (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0);
  const moveY = (keys['KeyS'] || keys['ArrowDown'] ? 1 : 0) - (keys['KeyW'] || keys['ArrowUp'] ? 1 : 0);
  if (moveX !== 0) player.facing = moveX;

  if (player.dashCd > 0) player.dashCd -= dt;
  if (mode === 'survivor' || mode === 'tower_defense') {
    let boost = 1;
    if (keys['Space'] && player.dashCd <= 0) {
      boost = 3.2 * jumpSpd;
      player.dashCd = 38;
      playSynthSfx('jump');
      spawnHitParticles(player.x, player.y, '#38bdf8', 8);
    }
    player.vx = moveX * 3.6 * moveSpd * boost;
    player.vy = moveY * 3.6 * moveSpd * boost;
    const nextX = Math.max(32, Math.min(canvas.width - 32, player.x + player.vx));
    const nextY = Math.max(32, Math.min(canvas.height - 32, player.y + player.vy));
    if (!isSolidWallAtPx(nextX, player.y)) player.x = nextX;
    if (!isSolidWallAtPx(player.x, nextY)) player.y = nextY;
  } else {
    player.vx = moveX * 4.2 * moveSpd;
    player.vy += 0.55 * dt;
    if ((keys['Space'] || keys['KeyW'] || keys['ArrowUp']) && player.grounded) {
      player.vy = -11.5 * jumpSpd;
      player.grounded = false;
      playSynthSfx('jump');
      spawnHitParticles(player.x, player.y + 16, '#7dd3fc', 6);
    }
    player.x = Math.max(32, Math.min(canvas.width - 32, player.x + player.vx));
    player.y += player.vy * dt;
    const floorY = 480;
    if (player.y >= floorY) {
      player.y = floorY;
      player.vy = 0;
      player.grounded = true;
    }
  }

  // Hazard cell check
  if (getCellAtPx(player.x, player.y) === 'hazard' && player.flash <= 0) {
    player.hp = Math.max(0, player.hp - 6);
    player.flash = 25;
    addShake(6.5);
    document.getElementById('hpVal').textContent = String(player.hp);
    spawnPopup(player.x, player.y - 24, '-6 HAZARD', '#fb923c', false);
  }

  // Chest pickup check
  for (let i = chests.length - 1; i >= 0; i--) {
    const ch = chests[i];
    if (Math.hypot(player.x - ch.x, player.y - ch.y) < 28) {
      chests.splice(i, 1);
      spawnHitParticles(ch.x, ch.y, '#fde047', 14);
      spawnPopup(ch.x, ch.y - 20, 'CHEST +35 XP!', '#fde047', true);
      gainXp(35);
    }
  }

  if (player.flash > 0) player.flash -= dt;

  // Auto-fire at nearest enemy
  fireTimer += dt * perks.fireRateScale;
  if (fireTimer >= 18 && enemies.length > 0) {
    fireTimer = 0;
    let nearest = enemies[0];
    let bestD = 1e9;
    for (const en of enemies) {
      const d = Math.hypot(en.x - player.x, en.y - player.y);
      if (d < bestD) { bestD = d; nearest = en; }
    }
    const ang = Math.atan2(nearest.y - player.y, nearest.x - player.x);
    fireProjectilesAt(ang);
  }

  // Defense Turrets auto-fire (Tower Defense mode)
  for (const tr of turrets) {
    if (tr.cd > 0) tr.cd -= dt * (1 + (tr.level - 1) * 0.25);
    if (tr.cd <= 0 && enemies.length > 0) {
      let target = null;
      let bestD = tr.range;
      for (const en of enemies) {
        const d = Math.hypot(en.x - tr.x, en.y - tr.y);
        if (d <= bestD) { bestD = d; target = en; }
      }
      if (target) {
        tr.cd = 24;
        tr.aim = Math.atan2(target.y - tr.y, target.x - tr.x);
        bullets.push({
          x: tr.x,
          y: tr.y,
          vx: Math.cos(tr.aim) * 10.5,
          vy: Math.sin(tr.aim) * 10.5,
          life: 65
        });
        playSynthSfx('shoot');
      }
    }
  }

  // Spawn enemies
  spawnTimer += aggro;
  if (spawnTimer >= 42 && enemies.length < 28) {
    spawnTimer = 0;
    const edge = Math.floor(Math.random() * 4);
    const ex = mode === 'tower_defense' ? 48 : (edge === 0 ? 36 : edge === 1 ? canvas.width - 36 : Math.random() * canvas.width);
    const ey = mode === 'platformer' ? 480 : mode === 'tower_defense' ? 300 : (edge === 2 ? 36 : edge === 3 ? canvas.height - 36 : Math.random() * canvas.height);
    enemies.push({ x: ex, y: ey, hp: 35, maxHp: 35, flash: 0 });
  }

  // Update bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.life <= 0 || isSolidWallAtPx(b.x, b.y)) { bullets.splice(i, 1); continue; }
    for (let j = enemies.length - 1; j >= 0; j--) {
      const en = enemies[j];
      if (Math.hypot(b.x - en.x, b.y - en.y) < 24) {
        const isCrit = Math.random() < (0.25 + perks.critBonus);
        const dmg = Math.round((isCrit ? 28 : 14) * perks.dmgScale);
        en.hp -= dmg;
        en.flash = 6;
        playSynthSfx('hit');
        if (isCrit) addShake(5.5);
        spawnHitParticles(en.x, en.y, isCrit ? '#fbbf24' : '#f87171', isCrit ? 10 : 5);
        spawnPopup(en.x, en.y - 18, isCrit ? '-' + dmg + '! CRIT' : '-' + dmg, isCrit ? '#fbbf24' : '#f8fafc', isCrit);
        bullets.splice(i, 1);
        if (en.hp <= 0) {
          gems.push({ x: en.x, y: en.y });
          enemies.splice(j, 1);
          kills++;
          gold += 15;
          const goldEl = document.getElementById('goldVal');
          if (goldEl) goldEl.textContent = String(gold);
          if (perks.lifesteal > 0) {
            player.hp = Math.min(player.maxHp, player.hp + perks.lifesteal);
            document.getElementById('hpVal').textContent = String(player.hp);
          }
          addShake(4.0);
          document.getElementById('killsVal').textContent = String(kills);
        }
        break;
      }
    }
  }

  // Update enemies
  for (const en of enemies) {
    const goalX = mode === 'tower_defense' && portal ? portal.x : player.x;
    const goalY = mode === 'tower_defense' && portal ? portal.y : player.y;
    const ang = Math.atan2(goalY - en.y, goalX - en.x);
    const nx = en.x + Math.cos(ang) * 1.45 * aggro;
    const ny = (mode === 'survivor' || mode === 'tower_defense') ? en.y + Math.sin(ang) * 1.45 * aggro : en.y;
    if (!isSolidWallAtPx(nx, en.y)) en.x = nx;
    if (!isSolidWallAtPx(en.x, ny)) en.y = ny;
    if (en.flash > 0) en.flash -= dt;
    if (Math.hypot(player.x - en.x, player.y - en.y) < 26 && player.flash <= 0) {
      player.hp = Math.max(0, player.hp - 5);
      player.flash = 20;
      addShake(8.0);
      document.getElementById('hpVal').textContent = String(player.hp);
      spawnPopup(player.x, player.y - 24, '-5', '#f43f5e', false);
    }
  }

  // Update XP gems
  for (let i = gems.length - 1; i >= 0; i--) {
    const g = gems[i];
    const d = Math.hypot(player.x - g.x, player.y - g.y);
    if (d < 120) {
      g.x += ((player.x - g.x) / d) * 5.6 * dt;
      g.y += ((player.y - g.y) / d) * 5.6 * dt;
    }
    if (d < 22) {
      playSynthSfx('pickup');
      spawnPopup(player.x, player.y - 28, '+15 XP', '#38bdf8', false);
      gems.splice(i, 1);
      gainXp(15);
    }
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (shakeTrauma > 0.2) {
    ctx.translate((Math.random() - 0.5) * shakeTrauma * 2, (Math.random() - 0.5) * shakeTrauma * 2);
  }

  // Render Level Map Grid Tiles (Wall / Hazard / Platform / Floor)
  for (let gy = 0; gy < lvlH; gy++) {
    const row = lvlGrid[gy];
    if (!row) continue;
    for (let gx = 0; gx < lvlW; gx++) {
      const cell = row[gx];
      const rx = gx * cellW;
      const ry = gy * cellH;
      const isBorder = gx === 0 || gx === lvlW - 1 || gy === 0 || gy === lvlH - 1;
      if (cell === 'wall' && (isBorder || Math.hypot(rx + cellW * 0.5 - 480, ry + cellH * 0.5 - 300) >= 64)) {
        if (tileSprite && tileSprite.complete && tileSprite.naturalWidth > 0) {
          ctx.drawImage(tileSprite, rx, ry, cellW, cellH);
        } else {
          ctx.fillStyle = isBorder ? '#162032' : '#1e293b';
          ctx.fillRect(rx, ry, cellW, cellH);
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.18)';
          ctx.strokeRect(rx + 0.5, ry + 0.5, cellW - 1, cellH - 1);
        }
      } else if (cell === 'hazard') {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.36)';
        ctx.fillRect(rx, ry, cellW, cellH);
        ctx.strokeStyle = '#f97316';
        ctx.strokeRect(rx + 2, ry + 2, cellW - 4, cellH - 4);
      } else if (cell === 'platform') {
        ctx.fillStyle = '#a16207';
        ctx.fillRect(rx, ry, cellW, 6);
      }
    }
  }

  // Subtle tile grid background
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.06)';
  ctx.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += 48) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += 48) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }

  if (mode === 'platformer') {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 504, canvas.width, 96);
    ctx.strokeStyle = '#38bdf8';
    ctx.beginPath(); ctx.moveTo(0, 504); ctx.lineTo(canvas.width, 504); ctx.stroke();
  }

  // Exit Portal vortex
  if (portal) {
    ctx.save();
    ctx.translate(portal.x, portal.y);
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, 16 + Math.sin(performance.now() * 0.006) * 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Treasure Chests
  for (const ch of chests) {
    ctx.save();
    ctx.fillStyle = '#eab308';
    ctx.fillRect(ch.x - 10, ch.y - 8, 20, 16);
    ctx.strokeStyle = '#fef08a';
    ctx.strokeRect(ch.x - 10, ch.y - 8, 20, 16);
    ctx.restore();
  }

  // Defense Turrets
  for (const tr of turrets) {
    ctx.save();
    ctx.translate(tr.x, tr.y);
    if (tuning.showDebugHitboxes || mode === 'tower_defense') {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.22)';
      ctx.beginPath();
      ctx.arc(0, 0, tr.range, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.rotate(tr.aim || 0);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(0, -4, 18, 8);
    ctx.restore();
  }

  // Gems
  for (const g of gems) {
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(g.x, g.y, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Particles
  for (const pt of particles) {
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x - 2, pt.y - 2, 4, 4);
  }

  // Enemies
  for (const en of enemies) {
    ctx.save();
    ctx.translate(en.x, en.y);
    if (enemySprite && enemySprite.complete && enemySprite.naturalWidth > 0) {
      ctx.drawImage(enemySprite, -22, -22, 44, 44);
    } else {
      ctx.fillStyle = en.flash > 0 ? '#ffffff' : '#ef4444';
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, Math.PI * 2);
      ctx.fill();
    }
    if (tuning.showDebugHitboxes) {
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-18, -18, 36, 36);
    }
    ctx.restore();
  }

  // Player
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.scale(player.facing, 1);
  if (playerSprite && playerSprite.complete && playerSprite.naturalWidth > 0) {
    ctx.drawImage(playerSprite, -26, -26, 52, 52);
  } else {
    ctx.fillStyle = player.flash % 4 > 1 ? '#ffffff' : '#22d3ee';
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fill();
  }
  if (tuning.showDebugHitboxes) {
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-20, -20, 40, 40);
    ctx.beginPath();
    ctx.arc(0, 0, 110, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.stroke();
  }
  ctx.restore();

  // Bullets
  ctx.fillStyle = '#fde047';
  for (const b of bullets) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, 5, 0, Math.PI * 2);
    ctx.fill();
    if (tuning.showDebugHitboxes) {
      ctx.strokeStyle = '#fde047';
      ctx.strokeRect(b.x - 6, b.y - 6, 12, 12);
    }
  }

  // Card Deckbuilder Mode Overlay
  if (mode === 'card_dbg') {
    ctx.fillStyle = 'rgba(10, 16, 30, 0.88)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Hero Panel (Left)
    ctx.fillStyle = '#13233a';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.fillRect(140, 140, 180, 190);
    ctx.strokeRect(140, 140, 180, 190);
    if (playerSprite && playerSprite.complete && playerSprite.naturalWidth > 0) {
      ctx.drawImage(playerSprite, 194, 165, 72, 72);
    } else {
      ctx.fillStyle = '#22d3ee';
      ctx.beginPath(); ctx.arc(230, 200, 30, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText('Valkyrie Hero', 182, 265);
    ctx.fillStyle = '#4ade80';
    ctx.fillText('HP: ' + player.hp + '/' + player.maxHp, 175, 288);
    ctx.fillStyle = '#38bdf8';
    ctx.fillText('Shield Block: ' + cardBlock, 175, 310);

    // Boss Panel (Right)
    ctx.fillStyle = '#281424';
    ctx.strokeStyle = '#f43f5e';
    ctx.fillRect(630, 140, 190, 190);
    ctx.strokeRect(630, 140, 190, 190);
    if (enemySprite && enemySprite.complete && enemySprite.naturalWidth > 0) {
      ctx.drawImage(enemySprite, 688, 165, 72, 72);
    } else {
      ctx.fillStyle = '#ef4444';
      ctx.beginPath(); ctx.arc(725, 200, 32, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#fda4af';
    ctx.fillText('Abyss Boss (Stage ' + bossStage + ')', 655, 265);
    ctx.fillStyle = '#f43f5e';
    ctx.fillText('Boss HP: ' + bossHp + '/' + bossMaxHp, 665, 288);
    ctx.fillStyle = '#fde047';
    ctx.fillText('Intent: Attack ' + bossIntentDmg, 665, 310);

    // Energy Orb & Turn Banner
    ctx.fillStyle = '#0284c7';
    ctx.beginPath(); ctx.arc(48, 480, 28, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#bae6fd';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.fillText(cardEnergy + '/' + cardMaxEnergy, 34, 485);
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('ENERGY', 26, 522);

    // 4 Hand Cards
    for (let i = 0; i < handCards.length; i++) {
      const c = handCards[i];
      const cx = 90 + i * 170;
      const cy = 395;
      ctx.fillStyle = c.played ? 'rgba(30, 41, 59, 0.35)' : '#162642';
      ctx.strokeStyle = c.played ? '#475569' : (c.cardType === 'attack' ? '#f97316' : '#38bdf8');
      ctx.lineWidth = 2;
      ctx.fillRect(cx, cy, 155, 175);
      ctx.strokeRect(cx, cy, 155, 175);
      ctx.fillStyle = '#fde047';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.fillText('[' + (i + 1) + '] Cost ' + c.cost, cx + 12, cy + 24);
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(String(c.name || 'Card').slice(0, 16), cx + 12, cy + 52);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText('Type: ' + (c.cardType || 'skill'), cx + 12, cy + 78);
      if (c.damage > 0) {
        ctx.fillStyle = '#fb923c';
        ctx.fillText('Damage: ' + Math.round(c.damage * perks.dmgScale), cx + 12, cy + 104);
      }
      if (c.block > 0) {
        ctx.fillStyle = '#38bdf8';
        ctx.fillText('Block: +' + c.block, cx + 12, cy + 126);
      }
      ctx.fillStyle = c.played ? '#64748b' : '#4ade80';
      ctx.fillText(c.played ? 'PLAYED' : 'Click or Key [' + (i + 1) + ']', cx + 12, cy + 156);
    }

    // End Turn Button
    ctx.fillStyle = '#be123c';
    ctx.strokeStyle = '#fda4af';
    ctx.fillRect(790, 455, 140, 68);
    ctx.strokeRect(790, 455, 140, 68);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.fillText('End Turn [E]', 812, 495);
  }

  // AVG Visual Novel Story Mode Overlay
  if (mode === 'avg_dialogue') {
    const node = getCurrentAvgNode();
    ctx.fillStyle = 'rgba(12, 18, 34, 0.9)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Stage Spotlight & Portrait
    ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
    ctx.beginPath(); ctx.arc(480, 195, 115, 0, Math.PI * 2); ctx.fill();
    if (playerSprite && playerSprite.complete && playerSprite.naturalWidth > 0) {
      ctx.drawImage(playerSprite, 416, 120, 128, 128);
    } else {
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath(); ctx.arc(480, 185, 48, 0, Math.PI * 2); ctx.fill();
    }

    // Emotion & Affinity Badge
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#38bdf8';
    ctx.fillRect(680, 28, 250, 64);
    ctx.strokeRect(680, 28, 250, 64);
    ctx.fillStyle = '#fde047';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText('Affinity: ' + avgAffinity + ' | Emotion: ' + (node.portraitEmotion || 'calm'), 694, 52);
    ctx.fillStyle = '#7dd3fc';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('Route: ' + String(avgRouteFlag).slice(0, 26), 694, 76);

    // Dialogue Window
    ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
    ctx.lineWidth = 2;
    ctx.fillRect(60, 340, 840, 125);
    ctx.strokeRect(60, 340, 840, 125);
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.fillText(String(node.speaker || 'Narrator'), 84, 372);

    const fullText = String(node.text || '');
    const shownText = fullText.slice(0, Math.max(1, Math.floor(avgCharIndex)));
    ctx.fillStyle = '#f8fafc';
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillText(shownText.slice(0, 78), 84, 405);
    if (shownText.length > 78) {
      ctx.fillText(shownText.slice(78, 156), 84, 430);
    }

    // Interactive Branching Choices
    const choices = Array.isArray(node.choices) ? node.choices : [];
    for (let i = 0; i < choices.length; i++) {
      const ch = choices[i];
      const cy = 485 + i * 44;
      ctx.fillStyle = '#162642';
      ctx.strokeStyle = '#fde047';
      ctx.fillRect(80, cy, 800, 36);
      ctx.strokeRect(80, cy, 800, 36);
      ctx.fillStyle = '#fef08a';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillText('[' + (i + 1) + '] ' + ch.label, 98, cy + 23);
    }
  }

  // Floating combat numbers (BMFont style)
  for (const p of popups) {
    ctx.save();
    ctx.font = (p.isCrit ? 'bold 18px' : 'bold 14px') + ' system-ui, sans-serif';
    ctx.fillStyle = p.color;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeText(p.text, p.x - 16, p.y);
    ctx.fillText(p.text, p.x - 16, p.y);
    ctx.restore();
  }
  ctx.restore();

  if (tuning.showDebugHitboxes) {
    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.84)';
    ctx.fillRect(12, 12, 260, 76);
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.55)';
    ctx.strokeRect(12, 12, 260, 76);
    ctx.fillStyle = '#4ade80';
    ctx.font = '12px monospace';
    ctx.fillText('FPS: ' + Math.round(fpsSmooth) + ' | TimeScale: ' + Number(tuning.timeScale).toFixed(2) + 'x', 20, 32);
    ctx.fillText('Entities: ' + enemies.length + ' Enemies / ' + bullets.length + ' Bullets', 20, 50);
    ctx.fillText('Move: ' + Number(tuning.moveSpeedScale).toFixed(1) + 'x | MultiShot: ' + perks.multiShot, 20, 68);
    ctx.restore();
  }
}

function loop(now) {
  const delta = Math.max(1, (now || performance.now()) - lastFrameTime);
  lastFrameTime = now || performance.now();
  fpsSmooth = fpsSmooth * 0.9 + (1000 / delta) * 0.1;
  update();
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
</script>
</body>
</html>
`

  return {
    title,
    mode,
    levelAlgorithm,
    html
  }
}
