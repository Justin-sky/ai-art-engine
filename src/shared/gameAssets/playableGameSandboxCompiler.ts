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

export type PlayableSandboxMode = 'platformer' | 'survivor'

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
  levelSeed?: number
  playerSpriteDataUrl?: string
  enemySpriteDataUrl?: string
  tileSpriteDataUrl?: string
  bgmDataUrl?: string
  sfxDataUrl?: string
  levelMap?: ProceduralLevelMapResult
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
  const mode: PlayableSandboxMode = options.mode ?? 'survivor'
  const levelAlgorithm: LevelGeneratorAlgorithm =
    mode === 'platformer' ? 'platformer_course' : 'arena_waves'

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
    justify-content: center;
    height: 100vh;
    overflow: hidden;
  }
  .hud-bar {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 8px 16px;
    background: rgba(14, 23, 38, 0.92);
    border: 1px solid rgba(56, 189, 248, 0.35);
    border-radius: 10px;
    margin-bottom: 8px;
    font-size: 13px;
  }
  .mode-btn {
    background: #13233a;
    color: #7dd3fc;
    border: 1px solid rgba(56, 189, 248, 0.4);
    border-radius: 6px;
    padding: 4px 10px;
    cursor: pointer;
    font-weight: 600;
  }
  .mode-btn.active {
    background: #0284c7;
    color: #fff;
  }
  canvas {
    border: 2px solid rgba(56, 189, 248, 0.45);
    border-radius: 10px;
    background: #0c1424;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.65);
    max-width: 96vw;
    max-height: 82vh;
  }
</style>
</head>
<body>
  <div class="hud-bar">
    <strong id="gameTitle"></strong>
    <span>HP: <b id="hpVal">100</b></span>
    <span>Score/XP: <b id="scoreVal">0</b></span>
    <span>Kills: <b id="killsVal">0</b></span>
    <button id="btnSurvivor" class="mode-btn">Survivor Mode (WASD + Auto-Fire)</button>
    <button id="btnPlatformer" class="mode-btn">Platformer Mode (A/D + Space + Click)</button>
  </div>
  <canvas id="stage" width="960" height="600"></canvas>
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
  }
});

const loadOptImage = (src) => {
  if (!src) return null;
  const img = new Image();
  img.src = src;
  return img;
};
const playerSprite = loadOptImage(CFG.playerImg);
const enemySprite = loadOptImage(CFG.enemyImg);
const tileSprite = loadOptImage(CFG.tileImg);

const keys = {};
window.addEventListener('keydown', (e) => { keys[e.code] = true; });
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

const player = { x: 480, y: 300, vx: 0, vy: 0, hp: 100, maxHp: 100, facing: 1, flash: 0, grounded: false, dashCd: 0 };
let bullets = [];
let enemies = [];
let gems = [];
let popups = [];
let particles = [];
let score = 0;
let kills = 0;
let fireTimer = 0;
let spawnTimer = 0;
let shakeTrauma = 0;
let lastFrameTime = performance.now();
let fpsSmooth = 60;

function addShake(amount) {
  shakeTrauma = Math.min(18, shakeTrauma + amount * (tuning.screenShakeScale ?? 1));
}

function setMode(nextMode) {
  mode = nextMode;
  document.getElementById('btnSurvivor').classList.toggle('active', mode === 'survivor');
  document.getElementById('btnPlatformer').classList.toggle('active', mode === 'platformer');
  player.x = 480;
  player.y = mode === 'platformer' ? 380 : 300;
  player.vx = 0;
  player.vy = 0;
  player.hp = 100;
  bullets = [];
  enemies = [];
  gems = [];
  popups = [];
  particles = [];
}

document.getElementById('btnSurvivor').onclick = () => setMode('survivor');
document.getElementById('btnPlatformer').onclick = () => setMode('platformer');
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

canvas.addEventListener('pointerdown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const tx = ((e.clientX - rect.left) / rect.width) * canvas.width;
  const ty = ((e.clientY - rect.top) / rect.height) * canvas.height;
  const ang = Math.atan2(ty - player.y, tx - player.x);
  bullets.push({ x: player.x, y: player.y, vx: Math.cos(ang) * 9, vy: Math.sin(ang) * 9, life: 70 });
});

function update() {
  const dt = Math.max(0.2, Math.min(1.8, Number(tuning.timeScale ?? 1.0)));
  const moveSpd = Number(tuning.moveSpeedScale ?? 1.0) * dt;
  const jumpSpd = Number(tuning.jumpDashScale ?? 1.0);
  const aggro = Number(tuning.enemyAggroScale ?? 1.0) * dt;

  const moveX = (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0) - (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0);
  const moveY = (keys['KeyS'] || keys['ArrowDown'] ? 1 : 0) - (keys['KeyW'] || keys['ArrowUp'] ? 1 : 0);
  if (moveX !== 0) player.facing = moveX;

  if (player.dashCd > 0) player.dashCd -= dt;
  if (mode === 'survivor') {
    let boost = 1;
    if (keys['Space'] && player.dashCd <= 0) {
      boost = 3.2 * jumpSpd;
      player.dashCd = 38;
      spawnHitParticles(player.x, player.y, '#38bdf8', 8);
    }
    player.vx = moveX * 3.6 * moveSpd * boost;
    player.vy = moveY * 3.6 * moveSpd * boost;
    player.x = Math.max(32, Math.min(canvas.width - 32, player.x + player.vx));
    player.y = Math.max(32, Math.min(canvas.height - 32, player.y + player.vy));
  } else {
    player.vx = moveX * 4.2 * moveSpd;
    player.vy += 0.55 * dt;
    if ((keys['Space'] || keys['KeyW'] || keys['ArrowUp']) && player.grounded) {
      player.vy = -11.5 * jumpSpd;
      player.grounded = false;
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

  if (player.flash > 0) player.flash -= dt;
  if (shakeTrauma > 0) shakeTrauma = Math.max(0, shakeTrauma - 0.85 * dt);

  // Auto-fire at nearest enemy
  fireTimer += dt;
  if (fireTimer >= 18 && enemies.length > 0) {
    fireTimer = 0;
    let nearest = enemies[0];
    let bestD = 1e9;
    for (const en of enemies) {
      const d = Math.hypot(en.x - player.x, en.y - player.y);
      if (d < bestD) { bestD = d; nearest = en; }
    }
    const ang = Math.atan2(nearest.y - player.y, nearest.x - player.x);
    bullets.push({ x: player.x, y: player.y, vx: Math.cos(ang) * 8.5, vy: Math.sin(ang) * 8.5, life: 75 });
  }

  // Spawn enemies
  spawnTimer += aggro;
  if (spawnTimer >= 42 && enemies.length < 28) {
    spawnTimer = 0;
    const edge = Math.floor(Math.random() * 4);
    const ex = edge === 0 ? 24 : edge === 1 ? canvas.width - 24 : Math.random() * canvas.width;
    const ey = mode === 'platformer' ? 480 : (edge === 2 ? 24 : edge === 3 ? canvas.height - 24 : Math.random() * canvas.height);
    enemies.push({ x: ex, y: ey, hp: 35, maxHp: 35, flash: 0 });
  }

  // Update bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.life <= 0) { bullets.splice(i, 1); continue; }
    for (let j = enemies.length - 1; j >= 0; j--) {
      const en = enemies[j];
      if (Math.hypot(b.x - en.x, b.y - en.y) < 24) {
        const isCrit = Math.random() < 0.3;
        const dmg = isCrit ? 28 : 14;
        en.hp -= dmg;
        en.flash = 6;
        if (isCrit) addShake(5.5);
        spawnHitParticles(en.x, en.y, isCrit ? '#fbbf24' : '#f87171', isCrit ? 10 : 5);
        spawnPopup(en.x, en.y - 18, isCrit ? '-' + dmg + '! CRIT' : '-' + dmg, isCrit ? '#fbbf24' : '#f8fafc', isCrit);
        bullets.splice(i, 1);
        if (en.hp <= 0) {
          gems.push({ x: en.x, y: en.y });
          enemies.splice(j, 1);
          kills++;
          addShake(4.0);
          document.getElementById('killsVal').textContent = String(kills);
        }
        break;
      }
    }
  }

  // Update enemies
  for (const en of enemies) {
    const ang = Math.atan2(player.y - en.y, player.x - en.x);
    en.x += Math.cos(ang) * 1.45 * aggro;
    if (mode === 'survivor') en.y += Math.sin(ang) * 1.45 * aggro;
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
    if (d < 110) {
      g.x += ((player.x - g.x) / d) * 5.2 * dt;
      g.y += ((player.y - g.y) / d) * 5.2 * dt;
    }
    if (d < 22) {
      score += 10;
      document.getElementById('scoreVal').textContent = String(score);
      spawnPopup(player.x, player.y - 28, '+10 XP', '#38bdf8', false);
      gems.splice(i, 1);
    }
  }

  // Update particles & damage popups
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
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (shakeTrauma > 0.2) {
    ctx.translate((Math.random() - 0.5) * shakeTrauma * 2, (Math.random() - 0.5) * shakeTrauma * 2);
  }

  // Subtle tile grid background
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
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
    ctx.fillRect(12, 12, 245, 76);
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.55)';
    ctx.strokeRect(12, 12, 245, 76);
    ctx.fillStyle = '#4ade80';
    ctx.font = '12px monospace';
    ctx.fillText('FPS: ' + Math.round(fpsSmooth) + ' | TimeScale: ' + Number(tuning.timeScale).toFixed(2) + 'x', 20, 32);
    ctx.fillText('Entities: ' + enemies.length + ' Enemies / ' + bullets.length + ' Bullets', 20, 50);
    ctx.fillText('Move: ' + Number(tuning.moveSpeedScale).toFixed(1) + 'x | Shake: ' + Number(tuning.screenShakeScale).toFixed(1) + 'x', 20, 68);
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
