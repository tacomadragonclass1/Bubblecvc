// He must never TELEPORT. Riding a recycling band round jumps him ~105 units
// upstage in a single frame while he is still plainly on screen, which is the
// one thing that breaks the illusion hardest. He swims instead.
import * as THREE from '../vendor/three.module.js';
import { createReefOctopus } from '../src/octopus.js';
import { FLOOR_Y, Z_BACK, Z_FRONT, SPAN, TRAVEL } from '../src/reef.js';

let pass=0, fail=0;
const ok=(n,c,x='')=>{ if(c){pass++;console.log('  ✓ '+n);} else {fail++;console.log('  ✗ '+n+(x?'  -> '+x:''));} };
function fakeReef(){ const bands=[];
  for(let i=0;i<5;i++){ const b=new THREE.Group(); b.position.z=Z_BACK+(i*SPAN)/5;
    for(let n=0;n<4;n++){ const c=new THREE.Group(); c.position.set((n-2)*22,FLOOR_Y,0);
      c.userData.isCluster=true; c.userData.clusterScale=2.2; b.add(c);} bands.push(b);} return {bands}; }
const advance=(r,dt)=>{for(const b of r.bands){b.position.z+=TRAVEL*dt; if(b.position.z>Z_FRONT) b.position.z-=SPAN;}};
const fake={make(){ const h=new THREE.Group();
  const mk=x=>new THREE.MeshStandardMaterial({color:new THREE.Color(x)});
  h.add(new THREE.Mesh(new THREE.SphereGeometry(1,8,6),mk(0x9b7290)));
  h.add(new THREE.Mesh(new THREE.SphereGeometry(0.1,6,4),mk(0xf4f6ff)));
  h.userData.mixer={timeScale:1}; return h; }};

console.log('\n1. he never jumps - every frame is a short step from the last');
{
  const reef=fakeReef(); const o=createReefOctopus(new THREE.Scene(), fake, ()=>reef);
  let t=0, prev=null, worst=0, worstAt=null, migrations=0, wasMigrating=false;
  for(let i=0;i<60*900;i++){                 // 15 minutes
    const dt=1/60; t+=dt; advance(reef,dt); o.update(t,dt,{});
    const s=o.state;
    if(!s){ prev=null; continue; }
    const migrating = s.mode==='migrate';
    if(migrating && !wasMigrating) migrations++;
    wasMigrating = migrating;
    const p={x:s.x,y:s.y,z:s.z};
    if(prev){
      const d=Math.hypot(p.x-prev.x,p.y-prev.y,p.z-prev.z);
      if(d>worst){ worst=d; worstAt=s.mode; }
    }
    prev=p;
  }
  // A teleport across the reef is ~105 units in one frame. Honest motion at
  // the dash speed (34 u/s) is well under 1 unit per frame.
  ok('largest single-frame move is a swim, not a jump', worst < 3.0,
     'worst ' + worst.toFixed(1) + ' units in one frame during "' + worstAt + '"');
  ok('he did migrate, repeatedly', migrations > 3, 'migrations=' + migrations);
}

console.log('\n1b. his position is ALWAYS a real number');
{
  const reef=fakeReef(); const o=createReefOctopus(new THREE.Scene(), fake, ()=>reef);
  let t=0, bad=0, badMode=null;
  for(let i=0;i<60*900;i++){ const dt=1/60; t+=dt; advance(reef,dt); o.update(t,dt,{});
    const s=o.state; if(!s) continue;
    if(!Number.isFinite(s.x)||!Number.isFinite(s.y)||!Number.isFinite(s.z)){
      bad++; badMode = badMode || s.mode; } }
  // Math.pow(negative, fractional) is NaN, and float error put the dash easing
  // a hair below zero on its final frame. One NaN frame per migration.
  ok('never NaN', bad === 0, bad + ' non-finite frames, first in "' + badMode + '"');
}

console.log('\n2. he leaves before his garden is overtaken');
{
  const reef=fakeReef(); const o=createReefOctopus(new THREE.Scene(), fake, ()=>reef);
  let t=0, ridePast=0;
  for(let i=0;i<60*900;i++){
    const dt=1/60; t+=dt; advance(reef,dt); o.update(t,dt,{});
    const s=o.state;
    // Perched (not migrating, not admiring) at a depth past the trigger means
    // he stayed on a doomed band.
    if(s && s.mode!=='migrate' && !s.mode.startsWith('admire') && s.z > -60) ridePast++;
  }
  ok('never still perched on a band that is about to recycle', ridePast === 0,
     ridePast + ' frames perched past z=-60');
}

console.log('\n3. the O routine outranks the commute');
{
  const reef=fakeReef(); const o=createReefOctopus(new THREE.Scene(), fake, ()=>reef);
  let t=0;
  for(let i=0;i<60*900;i++){ const dt=1/60; t+=dt; advance(reef,dt); o.update(t,dt,{});
    if(o.state && o.state.mode==='migrate') break; }
  ok('caught him mid-dash', o.state && o.state.mode==='migrate');
  o.admire();
  ok('admire() interrupts the dash', o.isAdmiring());
  for(let i=0;i<60*9;i++){ const dt=1/60; t+=dt; advance(reef,dt); o.update(t,dt,{}); }
  ok('and he gets there', o.isAdmiring() && o.state.mode === 'admire:hold',
     'mode=' + (o.state && o.state.mode));
}

console.log('\n' + (fail ? '✗ '+fail+' FAILED, ' : '✓ all ') + pass + ' passed');
process.exit(fail?1:0);
