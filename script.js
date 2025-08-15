/* Friends Snake - PWA */
(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const UI = {
    score: document.getElementById('score'),
    best: document.getElementById('best'),
    pauseBtn: document.getElementById('pauseBtn'),
    installBtn: document.getElementById('installBtn'),
    muteBtn: document.getElementById('muteBtn')
  };

  const GRID = 24;
  const COLS = canvas.width / GRID;
  const ROWS = canvas.height / GRID;

  const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const eq = (a, b) => a.x === b.x && a.y === b.y;
  const inside = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS;

  let snake, dir, pendingDir, food, obstacles, power, powerTimer, score, best, speed, baseSpeed;
  let paused = false;
  let ghost = 0; // ghost mode frames
  let last = 0;
  let installEvent = null;

  // Persistent best
  best = Number(localStorage.getItem('friends-snake-best') || 0);
  UI.best.textContent = best;

  // Audio (background loop + sfx) via WebAudio to avoid external assets
  const audio = {
    ctx: null,
    master: null,
    muted: false
  };
  function initAudio(){
    if (audio.ctx) return;
    audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
    audio.master = audio.ctx.createGain();
    audio.master.connect(audio.ctx.destination);
    audio.master.gain.value = 0.2;
    // Background loop: a tiny lo-fi coffeehouse chord arpeggio made from square waves
    const tempo = 110; // bpm
    const beat = 60/tempo;
    const notes = [0,4,7,12,7,4]; // major arpeggio offsets
    const base = 220; // A3
    function loop(){
      if (!audio.ctx) return;
      const t0 = audio.ctx.currentTime;
      for (let i=0;i<8;i++){
        const osc = audio.ctx.createOscillator();
        const gain = audio.ctx.createGain();
        osc.type = 'square';
        const note = notes[i % notes.length];
        osc.frequency.value = base * Math.pow(2, note/12);
        gain.gain.value = 0.0001;
        gain.gain.setValueAtTime(0.0001, t0 + i*beat);
        gain.gain.exponentialRampToValueAtTime(0.3, t0 + i*beat + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + i*beat + beat*0.9);
        osc.connect(gain).connect(audio.master);
        osc.start(t0 + i*beat);
        osc.stop(t0 + i*beat + beat);
      }
      setTimeout(loop, beat*8*1000);
    }
    loop();
  }
  function sfx(freq=440, time=0.08){
    if (!audio.ctx || audio.muted) return;
    const t = audio.ctx.currentTime;
    const o = audio.ctx.createOscillator();
    const g = audio.ctx.createGain();
    o.type = 'triangle'; o.frequency.value = freq;
    g.gain.value = 0.001;
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + time);
    o.connect(g).connect(audio.master);
    o.start(t); o.stop(t + time);
  }

  function reset() {
    snake = [{x: Math.floor(COLS/2), y: Math.floor(ROWS/2)}];
    dir = {x:1,y:0};
    pendingDir = dir;
    score = 0; UI.score.textContent = score;
    speed = 7; baseSpeed = 7;
    obstacles = [];
    ghost = 0;
    power = null; powerTimer = 0;
    placeFood();
    placeObstacles(12);
  }

  function placeFood(){
    do {
      food = {x: randInt(0, COLS-1), y: randInt(0, ROWS-1)};
    } while (occupied(food.x, food.y));
  }

  function placeObstacles(n){
    for (let i=0;i<n;i++){
      let p;
      do { p = {x: randInt(0,COLS-1), y: randInt(0,ROWS-1)} } while (occupied(p.x,p.y) || eq(p, food));
      obstacles.push(p);
    }
  }

  function placePower(){
    const types = ['star','coffee','shield']; // points, speed boost, ghost
    let p;
    do { p = {x: randInt(0,COLS-1), y: randInt(0,ROWS-1)} } while (occupied(p.x,p.y) || eq(p, food));
    p.kind = types[randInt(0,types.length-1)];
    power = p;
    powerTimer = 600; // frames (~10s at 60fps)
  }

  function occupied(x,y){
    if (snake.some(s => s.x===x && s.y===y)) return true;
    if (obstacles.some(o => o.x===x && o.y===y)) return true;
    return false;
  }

  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowup' || k === 'w') pendingDir = {x:0,y:-1};
    if (k === 'arrowdown' || k === 's') pendingDir = {x:0,y:1};
    if (k === 'arrowleft' || k === 'a') pendingDir = {x:-1,y:0};
    if (k === 'arrowright' || k === 'd') pendingDir = {x:1,y:0};
    if (k === 'p') togglePause();
    if (k === 'm') toggleMute();
    if (!audio.ctx) initAudio();
  }, {passive:true});

  UI.pauseBtn.onclick = () => togglePause();
  UI.muteBtn.onclick = () => toggleMute();

  function togglePause(){
    paused = !paused;
    UI.pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  }
  function toggleMute(){
    if (!audio.ctx) initAudio();
    audio.muted = !audio.muted;
    UI.muteBtn.textContent = audio.muted ? 'Unmute' : 'Mute';
    if (audio.master) audio.master.gain.value = audio.muted ? 0 : 0.2;
  }

  // PWA install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    UI.installBtn.hidden = false;
  });
  UI.installBtn.addEventListener('click', async () => {
    if (!installEvent) return;
    UI.installBtn.hidden = true;
    const res = await installEvent.prompt();
    installEvent = null;
  });

  // Game loop with variable speed
  function tick(t){
    requestAnimationFrame(tick);
    if (paused) return;
    const dt = (t - last) / 1000;
    const step = 1 / speed;
    if (dt < step) return;
    last = t;

    // dir change: prevent reversing
    if ((pendingDir.x !== -dir.x || pendingDir.y !== -dir.y) && (pendingDir.x !== dir.x || pendingDir.y !== dir.y)) {
      dir = pendingDir;
    }

    const head = {x: snake[0].x + dir.x, y: snake[0].y + dir.y};

    // walls -> wrap
    head.x = (head.x + COLS) % COLS;
    head.y = (head.y + ROWS) % ROWS;

    // collide with self / obstacles (unless ghost)
    if (!ghost && (snake.some((s,i)=> i>5 && eq(s, head)) || obstacles.some(o => eq(o, head)))){
      sfx(120,0.2);
      reset();
      return;
    }

    snake.unshift(head);
    // Food
    if (eq(head, food)){
      score += 10; UI.score.textContent = score; sfx(880,0.07);
      placeFood();
      if (!power && Math.random() < 0.4) placePower();
      // slightly increase difficulty
      baseSpeed = Math.min(18, baseSpeed + 0.2);
      speed = baseSpeed;
    } else {
      snake.pop();
    }

    // Power-ups
    if (power && eq(head, power)){
      if (power.kind === 'star'){ score += 30; sfx(1200,0.1); }
      if (power.kind === 'coffee'){ speed = Math.min(24, baseSpeed + 6); sfx(660,0.1); powerTimer = 240; } // temporary boost
      if (power.kind === 'shield'){ ghost = 200; sfx(520,0.12); }
      power = null;
    }
    if (ghost>0) ghost--;
    if (power){
      powerTimer--;
      if (powerTimer<=0) power=null;
    }

    best = Math.max(best, score);
    localStorage.setItem('friends-snake-best', best);
    UI.best.textContent = best;

    draw();
  }

  function tile(x,y,size=GRID,pad=2,color='#10b981',rounded=true){
    const xx = x*GRID+pad, yy = y*GRID+pad, w = size- pad*2, h = size - pad*2;
    if (rounded){
      const r = 6;
      ctx.beginPath();
      ctx.moveTo(xx+r, yy);
      ctx.arcTo(xx+w, yy, xx+w, yy+h, r);
      ctx.arcTo(xx+w, yy+h, xx, yy+h, r);
      ctx.arcTo(xx, yy+h, xx, yy, r);
      ctx.arcTo(xx, yy, xx+w, yy, r);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(xx,yy,w,h);
    }
  }

  function drawGrid(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    for(let x=0;x<COLS;x++){
      for(let y=0;y<ROWS;y++){
        if((x+y)%2===0){
          ctx.fillStyle = '#0b1222';
        }else{
          ctx.fillStyle = '#0c1426';
        }
        ctx.fillRect(x*GRID,y*GRID,GRID,GRID);
      }
    }
  }

  function draw(){
    drawGrid();
    // obstacles
    obstacles.forEach(o => tile(o.x,o.y,GRID,4,'#374151',false));
    // food
    tile(food.x, food.y, GRID, 4, '#f59e0b');
    // power
    if (power){
      const color = power.kind==='star' ? '#fbbf24' : power.kind==='coffee' ? '#10b981' : '#60a5fa';
      tile(power.x, power.y, GRID, 3, color);
      // emoji overlay
      ctx.font = '16px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline='middle';
      const e = power.kind==='star'?'⭐': power.kind==='coffee'?'☕':'🛡';
      ctx.fillText(e, power.x*GRID+GRID/2, power.y*GRID+GRID/2);
    }
    // snake
    snake.forEach((s,i)=>{
      const c = i===0 ? '#22d3ee' : '#10b981';
      tile(s.x, s.y, GRID, 3, ghost && i===0 ? '#93c5fd' : c);
    });
    // outline
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 2;
    ctx.strokeRect(1,1,canvas.width-2,canvas.height-2);
  }

  // Start
  reset();
  requestAnimationFrame(tick);

  // Register service worker
  if ('serviceWorker' in navigator){
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js');
    });
  }
})();
