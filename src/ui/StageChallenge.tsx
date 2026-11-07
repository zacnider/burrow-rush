import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Crosshair, RotateCcw, Sparkles, Zap } from "lucide-react";

interface Props { seed: string; level: number; mode: "DEFENSE" | "MEMORY"; onComplete: (moves: number, stars: number) => void }

function randomFor(seedText: string) {
  let seed = 2166136261;
  for (const character of seedText) { seed ^= character.charCodeAt(0); seed = Math.imul(seed, 16777619); }
  let state = seed >>> 0 || 0x9e3779b9;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
}

function makePattern(seed: string, count: number) {
  const random = randomFor(seed);
  return Array.from({ length: count }, () => Math.floor(random() * 9));
}

function makeMemoryPattern(seed: string, count: number) {
  const random = randomFor(seed);
  const sequence: number[] = [];
  while (sequence.length < count) {
    const next = Math.floor(random() * 9);
    if (next !== sequence[sequence.length - 1]) sequence.push(next);
  }
  return sequence;
}

export function StageChallenge({ seed, level, mode, onComplete }: Props) {
  const targetCount = Math.min(14, 4 + Math.floor(level * 0.75));
  const maxMisses = level <= 3 ? 5 : 3;
  const pattern = useMemo(() => makePattern(`${seed}:challenge:${level}`, targetCount), [seed, level, targetCount]);
  const [active, setActive] = useState(false);
  const [failed, setFailed] = useState(false);
  const [step, setStep] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [remaining, setRemaining] = useState(100);
  const [litIndex, setLitIndex] = useState<number | null>(null);
  const [showSequence, setShowSequence] = useState(false);
  const [showIndex, setShowIndex] = useState(0);
  const [showingGap, setShowingGap] = useState(false);
  const memorySequence = useMemo(() => makeMemoryPattern(`${seed}:memory:${level}`, Math.min(8, 2 + Math.floor((level + 1) / 3))), [seed, level]);

  useEffect(() => {
    if (mode !== "DEFENSE" || !active || failed) return;
    const duration = Math.max(1900, 4600 - level * 190);
    setRemaining(100);
    const started = Date.now();
    const interval = window.setInterval(() => setRemaining(Math.max(0, 100 - ((Date.now() - started) / duration) * 100)), 60);
    const timeout = window.setTimeout(() => {
      const nextMisses = mistakes + 1;
      setMistakes(nextMisses);
      if (nextMisses >= maxMisses) { setFailed(true); setActive(false); return; }
      if (step + 1 >= pattern.length) { setFailed(true); setActive(false); return; }
      setStep(step + 1);
    }, duration);
    return () => { window.clearInterval(interval); window.clearTimeout(timeout); };
  }, [mode, active, failed, level, maxMisses, mistakes, pattern.length, step]);

  useEffect(() => {
    if (mode !== "MEMORY" || !showSequence) return;
    if (showIndex >= memorySequence.length) { setShowSequence(false); setLitIndex(null); return; }
    if (showingGap) {
      const gapTimer = window.setTimeout(() => { setShowingGap(false); setShowIndex((index) => index + 1); }, 280);
      return () => window.clearTimeout(gapTimer);
    }
    setLitIndex(memorySequence[showIndex]);
    const timer = window.setTimeout(() => { setLitIndex(null); setShowingGap(true); }, 520);
    return () => window.clearTimeout(timer);
  }, [mode, showSequence, showIndex, showingGap, memorySequence]);

  const retry = () => { setFailed(false); setActive(false); setStep(0); setMistakes(0); setRemaining(100); setShowSequence(false); setShowIndex(0); setShowingGap(false); setLitIndex(null); };
  const startMemory = () => { setShowIndex(0); setShowSequence(true); setShowingGap(false); setStep(0); };
  const hit = (index: number) => {
    if (failed) return;
    if (!active) {
      setStep(0); setMistakes(0); setActive(true);
      return;
    }
    if (index !== pattern[step]) {
      const nextMisses = mistakes + 1; setMistakes(nextMisses);
      if (nextMisses >= maxMisses) { setFailed(true); setActive(false); }
      return;
    }
    if (step + 1 >= pattern.length) { setActive(false); onComplete(pattern.length + mistakes, Math.max(1, 3 - Math.floor(mistakes / 2))); }
    else setStep(step + 1);
  };
  const pressMemory = (index: number) => {
    if (showSequence || failed) return;
    const expected = memorySequence[step];
    if (index !== expected) {
      const nextMisses = mistakes + 1; setMistakes(nextMisses); setStep(0);
      if (nextMisses >= maxMisses) setFailed(true);
      return;
    }
    if (step + 1 >= memorySequence.length) onComplete(memorySequence.length + mistakes, Math.max(1, 3 - mistakes));
    else setStep(step + 1);
  };

  const isMemory = mode === "MEMORY";
  const progress = isMemory ? step : step;
  const total = isMemory ? memorySequence.length : pattern.length;
  return (
    <div className={`stage-challenge ${isMemory ? "memory-challenge" : "defense-challenge"}`}>
      <div className="challenge-hud"><span><i className={active || showSequence ? "challenge-live" : ""} /> {isMemory ? showSequence ? "STUDY THE SIGNAL" : "REPEAT THE SIGNAL" : active ? "CORE UNDER ATTACK" : "DEFENSE ON STANDBY"}</span><b>{String(Math.min(progress, total)).padStart(2, "0")} <small>/ {String(total).padStart(2, "0")}</small></b><span className="challenge-errors"><AlertTriangle size={12} /> {maxMisses - mistakes} {isMemory ? "TRIES" : "SHIELDS"}</span></div>
      <div className="challenge-meter"><i style={{ width: `${Math.min(100, (progress / total) * 100)}%` }} /></div>
      {isMemory ? <>
        <div className="memory-grid" aria-label="Nine signal nodes">
          {Array.from({ length: 9 }, (_, index) => <button key={index} className={`memory-node ${litIndex === index ? "is-lit" : ""}`} onClick={() => pressMemory(index)} disabled={showSequence || failed || !showIndex && step === 0 && !showSequence} aria-label={`Signal node ${index + 1}`}><span>{String(index + 1).padStart(2, "0")}</span></button>)}
        </div>
        <div className="challenge-controls"><p>{failed ? "Too many signal mismatches. Replay the sequence and try again." : showSequence ? "Watch the nodes. Repeat them in the same order." : step === 0 ? "Memorize the pulse pattern, then tap the nodes in order." : `Correct. ${memorySequence.length - step} pulses left.`}</p><button onClick={failed ? retry : startMemory} disabled={showSequence}>{failed ? <RotateCcw size={13} /> : <Sparkles size={13} />}{failed ? "RETRY" : step === 0 ? "SHOW PATTERN" : "WATCH AGAIN"}</button></div>
      </> : <>
        <div className="defense-field"><div className="defense-core"><Zap size={28} fill="currentColor" /><span>CORE</span></div><div className="defense-targets">{Array.from({ length: 9 }, (_, index) => <button key={index} className={`defense-target ${active && pattern[step] === index ? "is-target" : ""}`} onClick={() => hit(index)} disabled={failed} aria-label={active ? `Zap target sector ${index + 1}` : `Click to start defense at sector ${index + 1}`}><Crosshair size={18} /></button>)}</div><div className="defense-lock"><span>LOCK ON</span><i style={{ width: `${remaining}%` }} /></div></div>
        <div className="challenge-controls"><p>{failed ? "The core took too many hits. Restart the defense run." : active ? "Click the glowing glitch before it hits the core." : `Intercept ${targetCount} incoming glitches. You have ${maxMisses} shields.`}</p><button onClick={failed ? retry : () => { setStep(0); setMistakes(0); setFailed(false); setActive(true); }} disabled={active}>{failed ? <RotateCcw size={13} /> : <Crosshair size={13} />}{failed ? "RETRY" : "START DEFENSE"}</button></div>
      </>}
    </div>
  );
}
