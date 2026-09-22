/** 内置 2D 收集玩法样例（原生 Canvas，无外链） */
export const SAMPLE_GAME_HTML_2D = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<!-- game-mode: 2d -->
<title>Collect 2D</title>
<style>
  html,body{margin:0;height:100%;overflow:hidden;background:#0b1220;color:#e8eefc;font-family:system-ui,sans-serif}
  canvas{display:block;width:100%;height:100%}
  #hud{position:fixed;left:12px;top:12px;z-index:2;text-shadow:0 1px 2px #000}
</style>
</head>
<body>
<div id="hud">方向键 / WASD 移动 · 收集黄点 · R 重开</div>
<canvas id="c"></canvas>
<script>
(() => {
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const keys = Object.create(null);
  let w=0,h=0,score=0,won=false;
  const player={x:0,y:0,r:14,sp:220};
  let gems=[];
  function resize(){
    w=canvas.width=window.innerWidth;
    h=canvas.height=window.innerHeight;
  }
  function reset(){
    score=0;won=false;
    player.x=w/2;player.y=h/2;
    gems=Array.from({length:8},()=>({x:40+Math.random()*(w-80),y:40+Math.random()*(h-80),r:8}));
  }
  window.addEventListener('keydown',e=>{keys[e.key.toLowerCase()]=true; if(e.key==='r'||e.key==='R')reset();});
  window.addEventListener('keyup',e=>{keys[e.key.toLowerCase()]=false;});
  window.addEventListener('resize',()=>{resize();});
  resize();reset();
  let last=performance.now();
  function tick(now){
    const dt=Math.min(0.05,(now-last)/1000);last=now;
    if(!won){
      let dx=0,dy=0;
      if(keys['arrowleft']||keys['a'])dx-=1;
      if(keys['arrowright']||keys['d'])dx+=1;
      if(keys['arrowup']||keys['w'])dy-=1;
      if(keys['arrowdown']||keys['s'])dy+=1;
      const len=Math.hypot(dx,dy)||1;
      player.x=Math.max(player.r,Math.min(w-player.r,player.x+dx/len*player.sp*dt));
      player.y=Math.max(player.r,Math.min(h-player.r,player.y+dy/len*player.sp*dt));
      gems=gems.filter(g=>{
        if(Math.hypot(g.x-player.x,g.y-player.y)<player.r+g.r){score++;return false;}
        return true;
      });
      if(!gems.length)won=true;
    }
    ctx.fillStyle='#0b1220';ctx.fillRect(0,0,w,h);
    for(const g of gems){ctx.beginPath();ctx.arc(g.x,g.y,g.r,0,Math.PI*2);ctx.fillStyle='#f5c542';ctx.fill();}
    ctx.beginPath();ctx.arc(player.x,player.y,player.r,0,Math.PI*2);ctx.fillStyle='#5ad0ff';ctx.fill();
    ctx.fillStyle='#e8eefc';ctx.font='16px system-ui';
    ctx.fillText(won?('胜利！得分 '+score+' · 按 R 重开'):('得分 '+score+'/8'),12,h-16);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
</script>
</body>
</html>
`

/** 内置 3D 收集玩法样例（依赖 <!-- THREE_INJECT --> + import three） */
export const SAMPLE_GAME_HTML_3D = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<!-- game-mode: 3d -->
<!-- THREE_INJECT -->
<title>Collect 3D</title>
<style>
  html,body{margin:0;height:100%;overflow:hidden;background:#0b1220;color:#e8eefc;font-family:system-ui,sans-serif}
  canvas{display:block;width:100%;height:100%}
  #hud{position:fixed;left:12px;top:12px;z-index:2;text-shadow:0 1px 2px #000}
</style>
</head>
<body>
<div id="hud">WASD 移动 · 收集黄块 · R 重开</div>
<script type="module">
import * as THREE from 'three';
const scene=new THREE.Scene();
scene.background=new THREE.Color(0x0b1220);
const camera=new THREE.PerspectiveCamera(60,innerWidth/innerHeight,0.1,100);
camera.position.set(0,8,12);camera.lookAt(0,0,0);
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(devicePixelRatio);
document.body.appendChild(renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff,0.55));
const sun=new THREE.DirectionalLight(0xffffff,0.9);sun.position.set(4,10,6);scene.add(sun);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(24,24),new THREE.MeshStandardMaterial({color:0x1a2740}));
ground.rotation.x=-Math.PI/2;scene.add(ground);
const player=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0x5ad0ff}));
player.position.y=0.5;scene.add(player);
let gems=[];let score=0;let won=false;
function spawnGems(){
  for(const g of gems)scene.remove(g);
  gems=[];score=0;won=false;
  for(let i=0;i<6;i++){
    const m=new THREE.Mesh(new THREE.BoxGeometry(0.6,0.6,0.6),new THREE.MeshStandardMaterial({color:0xf5c542}));
    m.position.set((Math.random()-0.5)*10,0.3,(Math.random()-0.5)*10);scene.add(m);gems.push(m);
  }
}
spawnGems();
const keys=Object.create(null);
addEventListener('keydown',e=>{keys[e.key.toLowerCase()]=true;if(e.key==='r'||e.key==='R'){player.position.set(0,0.5,0);spawnGems();}});
addEventListener('keyup',e=>{keys[e.key.toLowerCase()]=false;});
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
const clock=new THREE.Clock();
function tick(){
  const dt=Math.min(0.05,clock.getDelta());
  if(!won){
    let dx=0,dz=0;
    if(keys['a']||keys['arrowleft'])dx-=1;
    if(keys['d']||keys['arrowright'])dx+=1;
    if(keys['w']||keys['arrowup'])dz-=1;
    if(keys['s']||keys['arrowdown'])dz+=1;
    const len=Math.hypot(dx,dz)||1;
    player.position.x=THREE.MathUtils.clamp(player.position.x+dx/len*6*dt,-11,11);
    player.position.z=THREE.MathUtils.clamp(player.position.z+dz/len*6*dt,-11,11);
    gems=gems.filter(g=>{
      if(g.position.distanceTo(player.position)<1.1){scene.remove(g);score++;return false;}
      g.rotation.y+=dt;return true;
    });
    if(!gems.length)won=true;
  }
  camera.position.x=THREE.MathUtils.lerp(camera.position.x,player.position.x,0.08);
  camera.position.z=THREE.MathUtils.lerp(camera.position.z,player.position.z+12,0.08);
  camera.lookAt(player.position.x,0,player.position.z);
  document.getElementById('hud').textContent=won?('胜利！'+score+' · R 重开'):('WASD · 得分 '+score+'/6');
  renderer.render(scene,camera);
  requestAnimationFrame(tick);
}
tick();
</script>
</body>
</html>
`
