(function () {
  'use strict';

  var T = 32;
  var MOVE_DELAY = 0.12; // segundos entre pasos al mantener una tecla
  var LEVELS = [
    { w: 15, h: 11, doors: 0, paper: false, time: 60 },
    { w: 19, h: 13, doors: 1, paper: true, time: 100 },
    { w: 23, h: 15, doors: 2, paper: true, time: 150 }
  ];
  var ASSETS = ['player', 'wall', 'floor', 'toilet', 'key', 'door', 'exit', 'paper'];
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function $(id) { return document.getElementById(id); }
  var canvas = $('game');
  var ctx = canvas.getContext('2d');
  var el = {
    level: $('hudLevel'), keys: $('hudKeys'), paper: $('hudPaper'), time: $('hudTime'),
    chipKeys: $('chipKeys'), chipPaper: $('chipPaper'),
    fill: $('urgFill'), msg: $('msg'),
    overlay: $('overlay'), ovTitle: $('ovTitle'), ovText: $('ovText'), ovBtn: $('ovBtn'),
    mute: $('muteBtn')
  };

  var img = {};
  var mode = 'loading'; // loading | title | play | transition | clear | won | lost
  var levelIdx = 0;
  var L = null;
  var held = [];
  var moveClock = 0;
  var clock = 0;
  var fx = [];
  var msgTimeout = null;

  /* ---------- sonido (ondas cuadradas, estilo 8 bits) ---------- */
  var ac = null;
  var muted = false;

  function beep(freq, dur, type, vol, slide, delay) {
    if (muted) return;
    if (!ac) {
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    }
    if (ac.state === 'suspended') ac.resume();
    var t0 = ac.currentTime + (delay || 0);
    var o = ac.createOscillator();
    var g = ac.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.linearRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol || 0.05, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(ac.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  var sfx = {
    step: function () { beep(170, 0.04, 'square', 0.025); },
    pickup: function () { beep(660, 0.08, 'square', 0.05); beep(990, 0.12, 'square', 0.05, 0, 0.08); },
    door: function () { beep(300, 0.25, 'sawtooth', 0.05, -200); beep(500, 0.1, 'square', 0.04, 0, 0.2); },
    error: function () { beep(120, 0.18, 'sawtooth', 0.06); },
    relief: function () {
      beep(180, 0.5, 'sawtooth', 0.08, -140);
      beep(392, 0.12, 'square', 0.05, 0, 0.55);
      beep(523, 0.12, 'square', 0.05, 0, 0.67);
      beep(784, 0.25, 'square', 0.05, 0, 0.79);
    },
    clear: function () {
      [523, 659, 784, 1047].forEach(function (f, i) { beep(f, 0.12, 'square', 0.05, 0, i * 0.1); });
    },
    lose: function () {
      beep(300, 0.3, 'square', 0.06, -200);
      beep(200, 0.5, 'sawtooth', 0.06, -150, 0.3);
    },
    tick: function () { beep(880, 0.03, 'square', 0.03); }
  };

  /* ---------- carga de assets ---------- */
  function loadAssets() {
    return Promise.all(ASSETS.map(function (name) {
      return new Promise(function (resolve, reject) {
        var im = new Image();
        im.onload = function () { img[name] = im; resolve(); };
        im.onerror = function () { reject(new Error('No se pudo cargar ' + name + '.svg')); };
        im.src = 'assets/' + name + '.svg';
      });
    }));
  }

  /* ---------- niveles ---------- */
  function xy(i, w) { return { x: i % w, y: (i / w) | 0 }; }
  function key(x, y) { return x + ',' + y; }

  function makeLevel(idx) {
    var cfg = LEVELS[idx];
    var data = Maze.buildLevel(cfg);
    var w = data.w;
    var s = xy(data.start, w);
    var lv = {
      cfg: cfg, w: w, h: data.h, grid: data.grid,
      toilet: xy(data.toilet, w), exit: xy(data.exit, w),
      doors: {}, items: {},
      p: { x: s.x, y: s.y, vx: s.x, vy: s.y },
      keys: 0, paper: false, needPaper: data.needPaper,
      relieved: false, remaining: cfg.time, lastTick: -1
    };
    data.doors.forEach(function (d) { var c = xy(d, w); lv.doors[key(c.x, c.y)] = { x: c.x, y: c.y, open: false }; });
    data.items.forEach(function (type, i) { var c = xy(i, w); lv.items[key(c.x, c.y)] = { x: c.x, y: c.y, type: type }; });
    return lv;
  }

  function startLevel(idx) {
    levelIdx = idx;
    L = makeLevel(idx);
    canvas.width = L.w * T;
    canvas.height = L.h * T;
    fx = [];
    held = [];
    mode = 'play';
    hideOverlay();
    el.level.textContent = String(idx + 1);
    el.chipKeys.hidden = L.cfg.doors === 0;
    el.chipPaper.hidden = !L.needPaper;
    var hint = L.needPaper
      ? 'Busca el papel' + (L.cfg.doors ? ', las llaves' : '') + ' y el v\u00e1ter.'
      : 'Encuentra el v\u00e1ter. \u00a1R\u00e1pido!';
    setMsg(hint, 4000);
  }

  /* ---------- UI ---------- */
  function setMsg(text, ms) {
    el.msg.textContent = text;
    clearTimeout(msgTimeout);
    msgTimeout = setTimeout(function () { el.msg.innerHTML = '&nbsp;'; }, ms || 2500);
  }

  function showOverlay(title, text, btn) {
    el.ovTitle.textContent = title;
    el.ovText.textContent = text;
    el.ovBtn.textContent = btn;
    el.overlay.classList.remove('hidden');
  }
  function hideOverlay() { el.overlay.classList.add('hidden'); }

  function popup(text, x, y, color) {
    fx.push({ text: text, x: x * T + T / 2, y: y * T, t: 0, life: 1.3, color: color || '#f1c40f' });
  }

  function urgency() {
    if (!L || L.relieved) return 0;
    return Math.min(1, Math.max(0, 1 - L.remaining / L.cfg.time));
  }

  function updateHud() {
    if (!L) return;
    el.keys.textContent = String(L.keys);
    el.paper.textContent = L.paper ? 'SI' : 'NO';
    el.chipPaper.classList.toggle('off', !L.paper);
    el.chipKeys.classList.toggle('off', L.keys === 0);
    el.time.textContent = L.relieved ? 'OK' : Math.ceil(Math.max(0, L.remaining)) + 'S';
    var u = urgency();
    el.fill.style.width = Math.round(u * 100) + '%';
    el.fill.style.background = 'hsl(' + Math.round(120 - 120 * u) + ', 80%, 50%)';
  }

  /* ---------- reglas ---------- */
  function tryMove(dx, dy) {
    var nx = L.p.x + dx, ny = L.p.y + dy;
    if (nx < 0 || ny < 0 || nx >= L.w || ny >= L.h || L.grid[ny][nx]) return false;
    var k = key(nx, ny);

    var door = L.doors[k];
    if (door && !door.open) {
      if (L.keys > 0) {
        L.keys--;
        door.open = true;
        sfx.door();
        popup('CLAC!', nx, ny, '#ffffff');
        setMsg('\u00a1Puerta abierta!');
      } else {
        sfx.error();
        setMsg('Puerta cerrada. Necesitas una llave.');
        return false;
      }
    }

    if (nx === L.toilet.x && ny === L.toilet.y && L.needPaper && !L.paper) {
      sfx.error();
      setMsg('\u00a1No hay papel! Busca el papel higi\u00e9nico.');
      return false;
    }

    if (nx === L.exit.x && ny === L.exit.y && !L.relieved) {
      sfx.error();
      setMsg('Primero el v\u00e1ter... \u00a1no puedes salir as\u00ed!');
      return false;
    }

    L.p.x = nx;
    L.p.y = ny;
    sfx.step();

    var item = L.items[k];
    if (item) {
      delete L.items[k];
      sfx.pickup();
      if (item.type === 'key') {
        L.keys++;
        popup('+LLAVE', nx, ny);
        setMsg('\u00a1Has cogido una llave!');
      } else {
        L.paper = true;
        popup('+PAPEL', nx, ny);
        setMsg('\u00a1Papel higi\u00e9nico! Ahora, al v\u00e1ter.');
      }
    }

    if (nx === L.toilet.x && ny === L.toilet.y && !L.relieved) relieve();
    else if (nx === L.exit.x && ny === L.exit.y && L.relieved) complete();
    return true;
  }

  function relieve() {
    L.relieved = true;
    sfx.relief();
    popup('\u00a1AHHH!', L.toilet.x, L.toilet.y - 0.5, '#2ecc71');
    setMsg('\u00a1Alivio total! Ahora busca la salida.', 4000);
  }

  function complete() {
    mode = 'transition';
    sfx.clear();
    popup('\u00a1LIBRE!', L.exit.x, L.exit.y, '#2ecc71');
    var last = levelIdx >= LEVELS.length - 1;
    setTimeout(function () {
      if (last) {
        mode = 'won';
        showOverlay('\u00a1LIBRE!', 'Pepe escap\u00f3 del laberinto, limpio y feliz. Fin del juego.', 'JUGAR OTRA VEZ');
      } else {
        mode = 'clear';
        showOverlay('\u00a1ALIVIO!', 'Nivel ' + (levelIdx + 1) + ' superado. El siguiente laberinto es m\u00e1s grande.', 'SIGUIENTE NIVEL');
      }
    }, 800);
  }

  function lose() {
    mode = 'lost';
    held = [];
    sfx.lose();
    updateHud();
    showOverlay('\u00a1ACCIDENTE!', 'Pepe no lleg\u00f3 a tiempo. Qu\u00e9 desastre...', 'REINTENTAR');
  }

  function action() {
    if (mode === 'title') startLevel(0);
    else if (mode === 'lost') startLevel(levelIdx);
    else if (mode === 'clear') startLevel(levelIdx + 1);
    else if (mode === 'won') startLevel(0);
  }

  /* ---------- bucle ---------- */
  function update(dt) {
    clock += dt;
    if (!L) return;

    if (mode === 'play') {
      moveClock -= dt;
      if (held.length && moveClock <= 0) {
        var d = held[held.length - 1];
        tryMove(d[0], d[1]);
        moveClock = MOVE_DELAY;
      }
      if (!L.relieved) {
        L.remaining -= dt;
        var secs = Math.ceil(L.remaining);
        if (L.remaining < 10 && secs !== L.lastTick && secs > 0) { L.lastTick = secs; sfx.tick(); }
        if (L.remaining <= 0) { L.remaining = 0; lose(); }
      }
    }

    var k = Math.min(1, dt * 18);
    L.p.vx += (L.p.x - L.p.vx) * k;
    L.p.vy += (L.p.y - L.p.vy) * k;

    for (var i = fx.length - 1; i >= 0; i--) {
      fx[i].t += dt;
      if (fx[i].t > fx[i].life) fx.splice(i, 1);
    }
    updateHud();
  }

  function draw() {
    if (!L) return;
    ctx.imageSmoothingEnabled = false;
    var x, y;

    for (y = 0; y < L.h; y++) {
      for (x = 0; x < L.w; x++) {
        ctx.drawImage(L.grid[y][x] ? img.wall : img.floor, x * T, y * T, T, T);
      }
    }

    // salida (apagada hasta que Pepe se alivie)
    ctx.save();
    ctx.globalAlpha = L.relieved ? 0.8 + 0.2 * Math.sin(clock * 8) : 0.35;
    ctx.drawImage(img.exit, L.exit.x * T, L.exit.y * T, T, T);
    ctx.restore();

    ctx.drawImage(img.toilet, L.toilet.x * T, L.toilet.y * T, T, T);

    Object.keys(L.doors).forEach(function (k) {
      var d = L.doors[k];
      if (!d.open) ctx.drawImage(img.door, d.x * T, d.y * T, T, T);
    });

    Object.keys(L.items).forEach(function (k) {
      var it = L.items[k];
      var bob = reduceMotion ? 0 : Math.round(Math.sin(clock * 4 + it.x) * 2);
      ctx.drawImage(img[it.type], it.x * T, it.y * T + bob, T, T);
    });

    // Pepe, temblando segun la prisa
    var u = urgency();
    var sx = 0, sy = 0;
    if (!reduceMotion && u > 0.5 && mode === 'play') {
      var amp = (u - 0.5) * 6;
      sx = Math.round((Math.random() - 0.5) * amp);
      sy = Math.round((Math.random() - 0.5) * amp);
    }
    ctx.drawImage(img.player, Math.round(L.p.vx * T) + sx, Math.round(L.p.vy * T) + sy, T, T);

    // aviso rojo cuando queda poco
    if (u > 0.7 && mode === 'play') {
      var flash = reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(clock * 10);
      ctx.fillStyle = 'rgba(231, 76, 60,' + ((u - 0.7) * 0.5 * flash).toFixed(3) + ')';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // textos flotantes
    ctx.font = 'bold 16px "Courier New", monospace';
    ctx.textAlign = 'center';
    fx.forEach(function (f) {
      var a = 1 - f.t / f.life;
      var py = f.y - f.t * 24;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = '#000';
      ctx.fillText(f.text, f.x + 2, py + 2);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, py);
    });
    ctx.globalAlpha = 1;
  }

  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  /* ---------- entrada ---------- */
  var DIR_KEYS = {
    ArrowUp: [0, -1], w: [0, -1], W: [0, -1],
    ArrowDown: [0, 1], s: [0, 1], S: [0, 1],
    ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0],
    ArrowRight: [1, 0], d: [1, 0], D: [1, 0]
  };

  // flechas y WASD comparten id para la misma direccion
  function kid(k) {
    k = k.toLowerCase();
    return { arrowup: 'w', arrowdown: 's', arrowleft: 'a', arrowright: 'd' }[k] || k;
  }

  function press(dir, id) {
    release(id);
    held.push(dir);
    held[held.length - 1].id = id;
    moveClock = 0;
  }
  function release(id) {
    held = held.filter(function (d) { return d.id !== id; });
  }

  window.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var dir = DIR_KEYS[e.key];
    if (dir) {
      e.preventDefault();
      if (!e.repeat) press(dir.slice(), kid(e.key));
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      if (mode !== 'play' && mode !== 'loading' && mode !== 'transition') {
        e.preventDefault();
        action();
      }
    } else if (e.key === 'm' || e.key === 'M') {
      toggleMute();
    }
  });
  window.addEventListener('keyup', function (e) {
    var dir = DIR_KEYS[e.key];
    if (dir) release(kid(e.key));
  });
  window.addEventListener('blur', function () { held = []; });

  el.ovBtn.addEventListener('click', action);
  el.overlay.addEventListener('click', function (e) { if (e.target === el.overlay) action(); });

  function toggleMute() {
    muted = !muted;
    el.mute.textContent = 'SONIDO: ' + (muted ? 'NO' : 'SI');
  }
  el.mute.addEventListener('click', toggleMute);

  // botones tactiles
  var PAD = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  Array.prototype.forEach.call(document.querySelectorAll('.dpad button'), function (b) {
    var id = 'pad-' + b.dataset.dir;
    b.addEventListener('pointerdown', function (e) { e.preventDefault(); press(PAD[b.dataset.dir].slice(), id); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
      b.addEventListener(ev, function () { release(id); });
    });
  });

  // deslizar el dedo sobre el laberinto
  var swipe = null;
  canvas.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse') return;
    swipe = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', function (e) {
    if (!swipe || mode !== 'play') { swipe = null; return; }
    var dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    swipe = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) tryMove(dx > 0 ? 1 : -1, 0);
    else tryMove(0, dy > 0 ? 1 : -1);
  });

  /* ---------- arranque ---------- */
  loadAssets().then(function () {
    L = makeLevel(0);
    canvas.width = L.w * T;
    canvas.height = L.h * T;
    el.chipKeys.hidden = true;
    el.chipPaper.hidden = true;
    mode = 'title';
    showOverlay('ESCAPE WC',
      'Pepe Prisas tiene MUCHA prisa. Encuentra el v\u00e1ter y escapa del laberinto antes de que sea tarde.',
      'PULSA ENTER');
    requestAnimationFrame(frame);
  }).catch(function (err) {
    showOverlay('ERROR', String(err.message || err), 'RECARGAR');
    el.ovBtn.onclick = function () { location.reload(); };
  });
})();
