// Render-only "juice" layer: ambient drifting motes + transient score/gameover
// spark bursts. It NEVER touches game state, so it may use Math.random freely
// and stays out of every engine's pure step/status/draw path. Counts are hard
// capped and buffers are reused, so there is no per-frame allocation storm.
//
// Wired by makeLoop: ambient draws behind entities, sparks in front.

const AMBIENT = 22;   // fixed pool, wraps around the screen
const MAX_SPARKS = 120;

export function makeJuice(W, H) {
  const motes = Array.from({ length: AMBIENT }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    vx: (Math.random() - 0.5) * 0.3,
    vy: 0.2 + Math.random() * 0.5,
    r: 1 + Math.random() * 2.2
  }));
  const sparks = []; // {x,y,vx,vy,life,max,r,color}

  const wrap = (v, hi) => (v < 0 ? v + hi : v > hi ? v - hi : v);

  return {
    // n particles flying out from (x,y); ignored past the cap so a runaway
    // score spree can't unbound the array.
    burst(x, y, color, n = 12, speed = 3.5) {
      for (let i = 0; i < n && sparks.length < MAX_SPARKS; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = speed * (0.4 + Math.random() * 0.8);
        sparks.push({
          x, y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 1,
          life: 1, max: 0.6 + Math.random() * 0.5,
          r: 1.5 + Math.random() * 2.5,
          color
        });
      }
    },

    update(dt) {
      for (const m of motes) {
        m.x = wrap(m.x + m.vx * dt, W);
        m.y = wrap(m.y + m.vy * dt, H);
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 0.12 * dt;     // gravity
        p.vx *= 0.98;
        p.life -= (dt / 60) / p.max;
        if (p.life <= 0) sparks.splice(i, 1);
      }
    },

    drawAmbient(ctx, color) {
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = color;
      for (const m of motes) {
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    },

    drawSparks(ctx) {
      ctx.save();
      for (const p of sparks) {
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  };
}
