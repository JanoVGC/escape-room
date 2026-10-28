/* Generador de laberintos para ESCAPE WC.
 * Laberinto perfecto (sin bucles): las puertas siempre estan en el camino
 * hacia el vater y las llaves y el papel siempre se pueden alcanzar antes. */
(function (root) {
  'use strict';

  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function shuffle(a, rnd) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // grid[y][x] === 1 -> pared, 0 -> suelo
  function generate(w, h, rnd) {
    var grid = [];
    for (var y = 0; y < h; y++) {
      grid.push(new Array(w).fill(1));
    }
    var stack = [[1, 1]];
    grid[1][1] = 0;
    while (stack.length) {
      var cur = stack[stack.length - 1];
      var x = cur[0], y2 = cur[1];
      var opts = shuffle([[2, 0], [-2, 0], [0, 2], [0, -2]], rnd).filter(function (d) {
        var nx = x + d[0], ny = y2 + d[1];
        return nx > 0 && ny > 0 && nx < w - 1 && ny < h - 1 && grid[ny][nx] === 1;
      });
      if (!opts.length) { stack.pop(); continue; }
      var d = opts[0];
      grid[y2 + d[1] / 2][x + d[0] / 2] = 0;
      grid[y2 + d[1]][x + d[0]] = 0;
      stack.push([x + d[0], y2 + d[1]]);
    }
    return grid;
  }

  function bfs(grid, w, h, start, blocked) {
    var dist = new Int32Array(w * h).fill(-1);
    var par = new Int32Array(w * h).fill(-1);
    var order = [start];
    dist[start] = 0;
    for (var qi = 0; qi < order.length; qi++) {
      var c = order[qi];
      var x = c % w, y = (c / w) | 0;
      for (var k = 0; k < 4; k++) {
        var nx = x + DIRS[k][0], ny = y + DIRS[k][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (grid[ny][nx]) continue;
        var n = ny * w + nx;
        if (dist[n] >= 0) continue;
        if (blocked && blocked.has(n)) continue;
        dist[n] = dist[c] + 1;
        par[n] = c;
        order.push(n);
      }
    }
    return { dist: dist, par: par, order: order };
  }

  function farthest(res, exclude) {
    var best = -1, bd = -1;
    for (var i = 0; i < res.order.length; i++) {
      var c = res.order[i];
      if (exclude.indexOf(c) >= 0) continue;
      if (res.dist[c] > bd) { bd = res.dist[c]; best = c; }
    }
    return best;
  }

  function pathTo(par, target) {
    var p = [];
    for (var c = target; c !== -1; c = par[c]) p.push(c);
    return p.reverse();
  }

  function buildLevel(cfg, rnd) {
    rnd = rnd || Math.random;
    var w = cfg.w, h = cfg.h;
    for (var attempt = 0; attempt < 200; attempt++) {
      var grid = generate(w, h, rnd);
      var start = 1 * w + 1;
      var r0 = bfs(grid, w, h, start);
      var toilet = farthest(r0, [start]);
      var path = pathTo(r0.par, toilet);
      var rT = bfs(grid, w, h, toilet);
      // La salida es un final de pasillo FUERA del camino hacia el vater,
      // asi nunca bloquea el paso antes de que Pepe se alivie.
      var onPath = new Set(path);
      var leaves = rT.order.filter(function (c) {
        if (onPath.has(c)) return false;
        var cx = c % w, cy = (c / w) | 0, open = 0;
        for (var k = 0; k < 4; k++) {
          if (!grid[cy + DIRS[k][1]][cx + DIRS[k][0]]) open++;
        }
        return open === 1;
      });
      if (!leaves.length) continue;
      var exit = farthest({ order: leaves, dist: rT.dist }, []);

      var doors = [];
      for (var i = 1; i <= cfg.doors; i++) {
        var idx = Math.round(path.length * i / (cfg.doors + 1));
        idx = Math.max(1, Math.min(path.length - 2, idx));
        var cell = path[idx];
        if (doors.indexOf(cell) < 0 && cell !== exit) doors.push(cell);
      }
      if (doors.length < cfg.doors) continue;

      var blocked = new Set(doors);
      var rA = bfs(grid, w, h, start, blocked);
      var cand = rA.order.filter(function (c) {
        return c !== start && c !== toilet && c !== exit && !blocked.has(c);
      });
      var need = cfg.doors + (cfg.paper ? 1 : 0);
      if (cand.length < need) continue;
      shuffle(cand, rnd);

      var items = new Map();
      var n = 0;
      for (var d = 0; d < cfg.doors; d++) items.set(cand[n++], 'key');
      if (cfg.paper) items.set(cand[n++], 'paper');

      return {
        w: w, h: h, grid: grid,
        start: start, toilet: toilet, exit: exit,
        doors: doors, items: items,
        needPaper: !!cfg.paper
      };
    }
    throw new Error('No se pudo generar el nivel');
  }

  var api = { generate: generate, bfs: bfs, buildLevel: buildLevel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Maze = api;
})(typeof window !== 'undefined' ? window : this);
