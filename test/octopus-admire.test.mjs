// The "O" routine: he leaves the reef, parks under the letter, and goes back.
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
const run=(o,r,secs)=>{ let t=0; for(let i=0;i<secs*60;i++){const dt=1/60;t+=dt;advance(r,dt);o.update(t,dt,{});} };

console.log('\n1. the letter calls him forward off the reef');
{
  const reef=fakeReef(); const scene=new THREE.Scene();
  const o=createReefOctopus(scene, fake, ()=>reef);
  // ⛔ He is a RESIDENT now - he is on the reef from the first frame, so there
  // is no "away" state to summon him out of any more.
  ok('starts already on the reef', o.state!==null && !o.isAdmiring());
  o.admire();
  ok('admire() pulls him off the reef', o.isAdmiring());
  run(o,reef,8);                         // the approach is distance-based now
  ok('still admiring after arriving', o.isAdmiring());
  o.release();
  ok('release() stops the routine', !o.isAdmiring());
  run(o,reef,4);
  ok('routine fully finished', !o.isAdmiring());
}

console.log('\n2. he leaves the reef to do it, and the reef gets him back');
{
  const reef=fakeReef(); const scene=new THREE.Scene();
  const o=createReefOctopus(scene, fake, ()=>reef);
  run(o,reef,120);                       // let him settle on a band
  o.admire();
  // ⛔ NOT `state === null`. state now reports the O routine and the migration
  // too, because he is plainly on screen during both - using null as a proxy
  // for "off the reef" was what made this read as absent.
  ok('leaves the band', o.isAdmiring() && o.state.mode.startsWith('admire'),
     'state=' + JSON.stringify(o.state));
  run(o,reef,4);
  ok('admiring', o.isAdmiring());
  o.release();
  run(o,reef,5);
  ok('back on the reef IMMEDIATELY after, not after a wrap', o.state!==null,
     'state=' + JSON.stringify(o.state));
}

console.log('\n3. the calls are idempotent (board state drives them every change)');
{
  const reef=fakeReef(); const o=createReefOctopus(new THREE.Scene(), fake, ()=>reef);
  o.admire(); o.admire(); o.admire();
  ok('repeated admire() is harmless', o.isAdmiring());
  run(o,reef,8);
  o.release(); o.release();
  ok('repeated release() is harmless', !o.isAdmiring());
  let threw=false;
  try { run(o,reef,5); } catch { threw=true; }
  ok('no error after double release', !threw);
}

console.log('\n4. re-summoned mid-retreat, he turns around');
{
  const reef=fakeReef(); const o=createReefOctopus(new THREE.Scene(), fake, ()=>reef);
  o.admire(); run(o,reef,8); o.release(); run(o,reef,0.5);
  o.admire();
  ok('admire() during the retreat resumes', o.isAdmiring());
  run(o,reef,8);
  ok('and settles back in', o.isAdmiring());
}

console.log('\n5. a shark outranks the letter');
{
  const reef=fakeReef(); const o=createReefOctopus(new THREE.Scene(), fake, ()=>reef);
  const runP = (secs, predator) => { let t=0;
    for(let i=0;i<secs*60;i++){const dt=1/60;t+=dt;advance(reef,dt);o.update(t,dt,{predator});} };
  o.admire(); runP(8, false);
  ok('admiring before the pass', o.isAdmiring());
  // The shark arrives.
  runP(1, true);
  ok('a pass sends him back', !o.isAdmiring());
  runP(4, true);
  // The board still has the O in it, so the app keeps asking.
  o.admire(); runP(2, true);
  ok('and he refuses to come back out while it lasts', !o.isAdmiring());
  ok('he is on the reef during the pass', o.state !== null,
     'state=' + JSON.stringify(o.state));
  // ⭐ The fear reaction itself: frozen and hidden, not scurrying about.
  ok('frozen, not scurrying', o.state.mode === 'rest', 'mode=' + o.state.mode);
  ok('and hiding hard', o.state.blend > 0.85, 'blend=' + o.state.blend);
  // Pass over - the app re-evaluates and the O is still there.
  runP(1, false);
  o.admire(); runP(6, false);
  ok('once it has gone he comes back for the letter', o.isAdmiring());
}

console.log('\n6. he is essentially always on the reef');
{
  const reef=fakeReef(); const o=createReefOctopus(new THREE.Scene(), fake, ()=>reef);
  let t=0, away=0, total=0;
  for(let i=0;i<60*600;i++){ const dt=1/60; t+=dt; advance(reef,dt); o.update(t,dt,{});
    total++; if(o.state===null && !o.isAdmiring()) away++; }
  const pct = away/total*100;
  ok('present ~100% of a 10 minute run', pct < 1.0, 'away ' + pct.toFixed(2) + '% of the time');
}
console.log('\n' + (fail ? '✗ '+fail+' FAILED, ' : '✓ all ') + pass + ' passed');
process.exit(fail?1:0);
