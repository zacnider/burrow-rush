import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Heart, Rocket, Shield, Sparkles } from "lucide-react";

interface Props {
  playing: boolean;
  progress: number;
  complete: boolean;
  score: number;
  onCollect: (amount: number) => void;
  onPlay: () => void;
}

interface Rock { x: number; y: number; size: number; speed: number; phase: number }
interface Dust { x: number; y: number; taken: boolean; phase: number }

export function ArcadeGame({ playing, progress, complete, score, onCollect, onPlay }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [lane, setLane] = useState(1);
  const [crashed, setCrashed] = useState(false);
  const [lives, setLives] = useState(3);
  const runRef = useRef({ lane: 1, playing: false, boostUntil: 0 });
  const gameRef = useRef({ lives: 3, invulnerableUntil: 0, nextBoostAt: 0 });
  const dynamicRef = useRef({ progress, onCollect });

  useEffect(() => { runRef.current.lane = lane; }, [lane]);
  useEffect(() => { runRef.current.playing = playing && !crashed && !complete; }, [playing, crashed, complete]);
  useEffect(() => { dynamicRef.current = { progress, onCollect }; }, [progress, onCollect]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let frame = 0;
    let previous = 0;
    let lastSpawn = 0;
    let rocks: Rock[] = [];
    let dust: Dust[] = [];
    let tick = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const draw = (now: number) => {
      const delta = Math.min(34, now - (previous || now));
      previous = now;
      const { width, height } = canvas.getBoundingClientRect();
      const playingNow = runRef.current.playing;
      const boosting = playingNow && now < runRef.current.boostUntil;
      const shielded = boosting || now < gameRef.current.invulnerableUntil;
      const moving = playingNow ? 1 : 0.25;
      tick += delta * (playingNow ? 0.001 : 0.00025);
      ctx.clearRect(0, 0, width, height);

      const sky = ctx.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, "#17232f"); sky.addColorStop(.61, "#354652"); sky.addColorStop(1, "#d89d61");
      ctx.fillStyle = sky; ctx.fillRect(0, 0, width, height);
      const px = width / 900; const py = height / 365;
      ctx.save(); ctx.scale(px, py);
      // Distant star field.
      for (let i = 0; i < 48; i++) {
        const x = ((i * 197 + 21) % 900);
        const y = ((i * 71 + 17) % 190);
        const alpha = .27 + Math.sin(tick * 2 + i) * .2;
        ctx.fillStyle = `rgba(255,247,211,${alpha})`;
        ctx.beginPath(); ctx.arc(x, y, i % 5 === 0 ? 1.7 : .85, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = "#e9dca9"; ctx.globalAlpha = .9; ctx.beginPath(); ctx.arc(739, 72, 28, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      // Layered moon ridges.
      ctx.fillStyle = "#71837f"; ctx.beginPath(); ctx.moveTo(0, 254); ctx.lineTo(127, 175); ctx.lineTo(231, 244); ctx.lineTo(374, 151); ctx.lineTo(536, 253); ctx.lineTo(679, 180); ctx.lineTo(900, 256); ctx.lineTo(900, 365); ctx.lineTo(0, 365); ctx.fill();
      ctx.fillStyle = "#4b645d"; ctx.beginPath(); ctx.moveTo(0, 284); ctx.lineTo(166, 227); ctx.lineTo(288, 280); ctx.lineTo(432, 209); ctx.lineTo(601, 286); ctx.lineTo(757, 214); ctx.lineTo(900, 269); ctx.lineTo(900, 365); ctx.lineTo(0, 365); ctx.fill();
      // Road stripes.
      ctx.strokeStyle = "rgba(247,226,167,.65)"; ctx.lineWidth = 2; ctx.setLineDash([9, 12]); ctx.lineDashOffset = -tick * 35 * moving;
      ctx.beginPath(); ctx.moveTo(20, 322); ctx.lineTo(880, 322); ctx.stroke(); ctx.setLineDash([]);
      for (const x of [183, 450, 717]) { ctx.strokeStyle = "rgba(241,232,192,.2)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, 274); ctx.lineTo(x, 348); ctx.stroke(); }
      // Spawned obstacles and stardust.
      if (playingNow && now - lastSpawn > 1050) {
        const lanePick = Math.floor(Math.random() * 3);
        if (Math.random() > .32) rocks.push({ x: 900, y: 275 + lanePick * 24, size: 10 + Math.random() * 9, speed: 150 + Math.random() * 55, phase: Math.random() * 6 });
        else dust.push({ x: 900, y: 275 + lanePick * 24, taken: false, phase: Math.random() * 6 });
        lastSpawn = now;
      }
      rocks = rocks.filter((rock) => rock.x > -35);
      for (const rock of rocks) {
        rock.x -= rock.speed * moving * (delta / 1000);
        const laneY = 275 + runRef.current.lane * 24;
        ctx.save(); ctx.translate(rock.x, rock.y); ctx.rotate(tick + rock.phase); ctx.fillStyle = "#aa8978"; ctx.strokeStyle = "#d7b49a"; ctx.lineWidth = 2;
        ctx.beginPath(); for (let p = 0; p < 8; p++) { const angle = p * Math.PI / 4; const radius = rock.size * (p % 2 ? .8 : 1.15); const x = Math.cos(angle) * radius; const y = Math.sin(angle) * radius; if (!p) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
        if (playingNow && !shielded && now >= gameRef.current.invulnerableUntil && Math.abs(rock.x - 167) < rock.size + 17 && Math.abs(rock.y - laneY) < rock.size + 11) {
          gameRef.current.lives = Math.max(0, gameRef.current.lives - 1);
          gameRef.current.invulnerableUntil = now + 1150;
          setLives(gameRef.current.lives);
          if (gameRef.current.lives === 0) { runRef.current.playing = false; setCrashed(true); }
        }
      }
      dust = dust.filter((orb) => orb.x > -20 && !orb.taken);
      for (const orb of dust) {
        orb.x -= 160 * moving * (delta / 1000);
        const laneY = 275 + runRef.current.lane * 24;
        const pulse = Math.sin(tick * 4 + orb.phase) * 3;
        ctx.fillStyle = "#d9ef64"; ctx.shadowColor = "#d9ef64"; ctx.shadowBlur = 14;
        ctx.beginPath(); ctx.arc(orb.x, orb.y + pulse, 6, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
        if (playingNow && Math.abs(orb.x - 167) < 18 && Math.abs(orb.y - laneY) < 17) {
          orb.taken = true; dynamicRef.current.onCollect(1);
        }
      }
      // Rover with a warm halo.
      const roverY = 275 + runRef.current.lane * 24 + Math.sin(tick * 8) * (playingNow ? 3 : 1);
      ctx.save(); ctx.translate(167, roverY);
      if (shielded && Math.floor(now / 80) % 2 === 0) ctx.globalAlpha = .42;
      ctx.fillStyle = "rgba(217,239,100,.15)"; ctx.beginPath(); ctx.ellipse(0, 5, 40, 22, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#d9ef64"; ctx.beginPath(); ctx.roundRect(-25, -14, 48, 25, 8); ctx.fill();
      ctx.fillStyle = "#202821"; ctx.beginPath(); ctx.arc(-13, 12, 5, 0, Math.PI * 2); ctx.arc(12, 12, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#6b4635"; ctx.beginPath(); ctx.ellipse(-4, -14, 12, 9, 0, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#e6b69b"; ctx.beginPath(); ctx.arc(-13, -19, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#29312b"; ctx.beginPath(); ctx.arc(1, -15, 1.5, 0, Math.PI * 2); ctx.fill();
      if (shielded) { ctx.globalAlpha = .75; ctx.strokeStyle = boosting ? "#d9ef64" : "#f5d9a6"; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, -3, 39, 29, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
      if (boosting) { ctx.fillStyle = "#f2693c"; ctx.beginPath(); ctx.moveTo(-25, -1); ctx.lineTo(-47, -9 + Math.sin(tick * 30) * 4); ctx.lineTo(-25, 5); ctx.fill(); }
      ctx.restore();
      // Progress pinpoints along the trail.
      for (let i = 0; i < 9; i++) { const x = 250 + i * 70; ctx.fillStyle = i / 8 <= dynamicRef.current.progress / 100 ? "#d9ef64" : "rgba(245,241,224,.3)"; ctx.beginPath(); ctx.arc(x, 322, 3, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") { event.preventDefault(); setLane((value) => Math.max(0, value - 1)); }
      if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") { event.preventDefault(); setLane((value) => Math.min(2, value + 1)); }
      if (event.code === "Space") { event.preventDefault(); triggerBoost(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, []);

  useEffect(() => { if (complete) setCrashed(false); }, [complete]);

  const triggerBoost = () => {
    const now = performance.now();
    if (now >= gameRef.current.nextBoostAt && runRef.current.playing) {
      runRef.current.boostUntil = now + 520;
      gameRef.current.nextBoostAt = now + 1750;
    }
  };
  const restart = () => { gameRef.current.lives = 3; gameRef.current.invulnerableUntil = 0; setLives(3); setCrashed(false); onPlay(); };
  const pointerStart = useRef<number | null>(null);

  return (
    <div className="arcade-screen">
      <canvas ref={canvasRef} aria-label="Playable rover game. Use the left and right arrow keys to steer, and space to boost." />
      <div className="canvas-hud"><span><i className="hud-live-dot" /> {playing && !crashed ? "FLIGHT LIVE" : crashed ? "ROVER REPAIR" : "READY FOR LAUNCH"}</span><span className="hud-score"><Sparkles size={13} /> {score} STARDUST</span><span className="hud-lives" aria-label={`${lives} lives remaining`}>{[0, 1, 2].map((index) => <Heart key={index} size={12} fill={index < lives ? "currentColor" : "none"} />)}</span></div>
      <div className="canvas-mission"><span>CONFIRMED WORK</span><b>{Math.floor(Math.min(progress, 100))}%</b><div><i style={{ width: `${Math.min(progress, 100)}%` }} /></div></div>
      {!playing && !complete && !crashed && <div className="game-overlay"><div className="overlay-orbit"><Rocket size={30} /></div><span className="overlay-kicker">SQUEEK ROVER · FLIGHT 001</span><h3>Ready for liftoff?</h3><p><b>← →</b> steer between lanes. Grab green stardust for points. Rocks cost a heart; press <b>space</b> for a short shield boost.</p><div className="overlay-chain-note"><Sparkles size={13} /> Confirmed hamster work fuels the checkpoint.</div><button onClick={onPlay}>Start flight <ArrowUpRight size={14} /></button></div>}
      {crashed && <div className="game-overlay compact"><div className="overlay-orbit repair"><span>✳</span></div><span className="overlay-kicker">ROVER NEEDS A REPAIR</span><h3>Flight paused.</h3><p>Your chain fuel and mission progress stay saved. Relaunch and try a different lane.</p><button onClick={restart}>Repair & relaunch <ArrowUpRight size={14} /></button></div>}
      {complete && <div className="game-overlay compact success"><div className="overlay-orbit"><Sparkles size={26} /></div><span className="overlay-kicker">CONFIRMED CHECKPOINT</span><h3>New world unlocked!</h3><p>Squeektoshi’s settled work carried the rover all the way. Your flight score is still yours.</p><button onClick={restart}>Explore the new world <ArrowUpRight size={14} /></button></div>}
      <div className="touch-controls"><button aria-label="Steer left" onPointerDown={() => setLane((value) => Math.max(0, value - 1))}><ArrowLeft size={18} /></button><button aria-label="Shield boost" onPointerDown={triggerBoost}><Shield size={17} /></button><button aria-label="Steer right" onPointerDown={() => setLane((value) => Math.min(2, value + 1))}><ArrowRight size={18} /></button></div>
      <div className="lane-touch" onPointerDown={(event) => { pointerStart.current = event.clientX; }} onPointerUp={(event) => { if (pointerStart.current === null) return; const delta = event.clientX - pointerStart.current; if (Math.abs(delta) > 25) setLane((value) => Math.max(0, Math.min(2, value + (delta > 0 ? 1 : -1)))); pointerStart.current = null; }} aria-hidden="true" />
    </div>
  );
}
