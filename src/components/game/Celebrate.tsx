'use client';

// ─── This week's win effects: confetti, sparkles, embers and coins on one canvas ───
// One fixed canvas over the page, idle until something is won. Each kind marks a
// different win: a step done (a small burst at the button), the streak growing (embers
// rising off the flame), a badge (gold stars), today's run finished (confetti from both
// corners) and a deal won (baht coins falling). Flat 2D shapes, a second or two each.
// Nothing runs when the device asks for reduced motion.

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';

export type CelebrationKind = 'burst' | 'embers' | 'gold' | 'confetti' | 'coins';
export interface Point { x: number; y: number }

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; ttl: number;
  size: number; spin: number; angle: number;
  color: string;
  shape: 'rect' | 'dot' | 'star' | 'coin' | 'ember';
  gravity: number; drag: number;
}

const CelebrateContext = createContext<{ fire: (kind: CelebrationKind, at?: Point | Element | null) => void }>({ fire: () => {} });

export const useCelebrate = () => useContext(CelebrateContext);

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function token(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function centerOf(at: Point | Element | null | undefined): Point {
  if (at && 'getBoundingClientRect' in at) {
    const r = at.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  if (at && 'x' in at) return at;
  return { x: window.innerWidth / 2, y: window.innerHeight / 3 };
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function spawn(kind: CelebrationKind, at: Point): Particle[] {
  const palette = [
    token('--color-clay-lavender', '#b8a4ed'), token('--color-clay-mint', '#7fc9a8'), token('--color-clay-ochre', '#c49010'),
    token('--color-clay-coral', '#e0766a'), token('--color-clay-peach', '#f2b48c'), token('--color-clay-pink', '#d98ba8'),
  ];
  const gold = [token('--color-clay-ochre', '#c49010'), token('--color-clay-warning', '#eec35a'), '#f7dc8a'];
  const fire = [token('--color-clay-coral', '#e0766a'), token('--color-clay-ochre', '#c49010'), token('--color-clay-warning', '#eec35a')];
  const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];
  const out: Particle[] = [];
  const base = { life: 0, spin: 0, angle: 0, gravity: 0.18, drag: 0.985 };

  if (kind === 'burst') {
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + rand(-0.2, 0.2);
      const v = rand(2.4, 5.2);
      out.push({ ...base, x: at.x, y: at.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1.2, ttl: rand(32, 48), size: rand(3, 5.5), color: pick(palette), shape: i % 3 ? 'dot' : 'rect', spin: rand(-0.3, 0.3), gravity: 0.12, drag: 0.93 });
    }
  } else if (kind === 'embers') {
    for (let i = 0; i < 26; i++) {
      out.push({ ...base, x: at.x + rand(-10, 10), y: at.y + rand(-4, 8), vx: rand(-1.1, 1.1), vy: rand(-4.2, -1.6), ttl: rand(40, 70), size: rand(2, 4.2), color: pick(fire), shape: 'ember', gravity: -0.015, drag: 0.975 });
    }
  } else if (kind === 'gold') {
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const v = rand(3, 7.5);
      out.push({ ...base, x: at.x, y: at.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1.5, ttl: rand(46, 72), size: rand(5, 9), color: pick(gold), shape: 'star', spin: rand(-0.25, 0.25), gravity: 0.1, drag: 0.95 });
    }
    for (let i = 0; i < 50; i++) {
      out.push({ ...base, x: at.x + rand(-60, 60), y: at.y + rand(-20, 20), vx: rand(-5, 5), vy: rand(-9, -3), ttl: rand(70, 110), size: rand(5, 9), color: pick(palette), shape: 'rect', spin: rand(-0.3, 0.3) });
    }
  } else if (kind === 'confetti') {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const side of [0, 1]) {
      for (let i = 0; i < 110; i++) {
        const x = side ? w + 10 : -10;
        out.push({ ...base, x, y: h * rand(0.55, 0.95), vx: (side ? -1 : 1) * rand(5, 15), vy: rand(-19, -8), ttl: rand(110, 170), size: rand(6, 11), color: pick(palette), shape: i % 5 ? 'rect' : 'dot', spin: rand(-0.35, 0.35), gravity: 0.32, drag: 0.982 });
      }
    }
    for (let i = 0; i < 70; i++) {
      out.push({ ...base, x: rand(0, w), y: rand(-80, -10), vx: rand(-1.5, 1.5), vy: rand(1, 4), ttl: rand(150, 220), size: rand(6, 10), color: pick(palette), shape: 'rect', spin: rand(-0.25, 0.25), gravity: 0.06, drag: 0.99 });
    }
  } else if (kind === 'coins') {
    for (let i = 0; i < 34; i++) {
      out.push({ ...base, x: at.x + rand(-220, 220), y: at.y - rand(120, 420), vx: rand(-0.8, 0.8), vy: rand(1, 3.5), ttl: rand(110, 160), size: rand(9, 14), color: pick(gold), shape: 'coin', spin: rand(0.08, 0.22), gravity: 0.22, drag: 0.99 });
    }
    out.push(...spawn('gold', at).slice(0, 24));
  }
  return out;
}

function draw(ctx: CanvasRenderingContext2D, p: Particle) {
  const fade = Math.max(0, 1 - Math.pow(p.life / p.ttl, 3));
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  ctx.fillStyle = p.color;
  switch (p.shape) {
    case 'rect':
      // a paper strip that turns over as it falls
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, (p.size / 2) * Math.abs(Math.cos(p.life * 0.18 + p.size)));
      break;
    case 'dot':
    case 'ember':
      ctx.beginPath();
      ctx.arc(0, 0, p.shape === 'ember' ? p.size * (1 - p.life / p.ttl * 0.6) : p.size / 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'star': {
      const r = p.size / 2;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const rr = i % 2 ? r * 0.45 : r;
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'coin': {
      const squash = Math.abs(Math.cos(p.angle * 3));
      ctx.rotate(-p.angle);
      ctx.scale(Math.max(0.15, squash), 1);
      ctx.beginPath();
      ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120, 80, 0, 0.45)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      if (squash > 0.5) {
        ctx.fillStyle = 'rgba(110, 70, 0, 0.75)';
        ctx.font = `700 ${Math.round(p.size * 0.62)}px ui-sans-serif, system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('฿', 0, 0.5);
      }
      break;
    }
  }
  ctx.restore();
}

export function CelebrateProvider({ children }: { children: ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particles = useRef<Particle[]>([]);
  const frame = useRef<number | null>(null);

  // One frame of the effect; it schedules the next while anything is still flying.
  const step = useRef<() => void>(() => {});
  useEffect(() => {
    step.current = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext?.('2d');
    if (!canvas || !ctx) { particles.current = []; frame.current = null; return; }
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(window.innerWidth * dpr) || canvas.height !== Math.round(window.innerHeight * dpr)) {
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    particles.current = particles.current.filter(p => p.life < p.ttl && p.y < window.innerHeight + 60);
    for (const p of particles.current) {
      p.life += 1;
      p.vx *= p.drag;
      p.vy = p.vy * p.drag + p.gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.angle += p.spin;
      draw(ctx, p);
    }
    frame.current = particles.current.length ? requestAnimationFrame(() => step.current()) : null;
    if (!frame.current) ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    };
  }, []);

  const fire = useCallback((kind: CelebrationKind, at?: Point | Element | null) => {
    if (prefersReducedMotion() || typeof window === 'undefined') return;
    particles.current.push(...spawn(kind, centerOf(at)));
    if (frame.current === null && typeof requestAnimationFrame === 'function') frame.current = requestAnimationFrame(() => step.current());
  }, []);

  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);

  return (
    <CelebrateContext.Provider value={{ fire }}>
      {children}
      <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[90] h-full w-full" />
    </CelebrateContext.Provider>
  );
}
