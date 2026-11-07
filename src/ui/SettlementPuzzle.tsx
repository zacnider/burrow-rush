import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ArrowUpRight, Check, Copy, RotateCcw, Trophy } from "lucide-react";
import { canSlideTile, createNumberSlide, isNumberSlideSolved, slideTile } from "../game/numberslide";

interface Props { seed: string; blockHeight: string; transactionUrl: string; confirmed: boolean }
interface CampaignSave { unlocked: number; stars: Record<number, number>; bestMoves: Record<number, number> }
const SAVE_KEY = "squeek-trigger-campaign-v3";
const LAST_LEVEL = 12;

function readSave(): CampaignSave {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVE_KEY) ?? "null") as Partial<CampaignSave> | null;
    return { unlocked: Math.max(1, Math.min(LAST_LEVEL, parsed?.unlocked ?? 1)), stars: parsed?.stars ?? {}, bestMoves: parsed?.bestMoves ?? {} };
  } catch { return { unlocked: 1, stars: {}, bestMoves: {} }; }
}

function formatSize(size: number) { return `${size} × ${size}`; }

export function SettlementPuzzle({ seed, blockHeight, transactionUrl, confirmed }: Props) {
  const [campaign, setCampaign] = useState(readSave);
  const [level, setLevel] = useState(() => readSave().unlocked);
  const boardSeed = `${seed}:level:${level}`;
  const puzzle = useMemo(() => createNumberSlide(boardSeed, level), [boardSeed, level]);
  const [tiles, setTiles] = useState(puzzle.tiles);
  const [moves, setMoves] = useState(0);
  const [won, setWon] = useState(false);
  const [failed, setFailed] = useState(false);
  const [started, setStarted] = useState(false);
  const timeLimit = puzzle.size === 3 ? 110 - (level - 1) * 12 : puzzle.size === 4 ? 270 - (level - 4) * 22 : 480 - (level - 9) * 25;
  const [timeLeft, setTimeLeft] = useState(timeLimit);
  const moveLimit = Math.ceil(puzzle.scrambleMoves * 1.35);
  const [copied, setCopied] = useState(false);
  const best = campaign.bestMoves[level];
  const completed = Object.keys(campaign.stars).length;
  const starsTotal = Object.values(campaign.stars).reduce((sum, value) => sum + value, 0);

  useEffect(() => {
    if (!started || won || failed) return;
    const timer = window.setInterval(() => setTimeLeft((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [started, won, failed]);

  useEffect(() => {
    if (started && timeLeft === 0 && !won) setFailed(true);
  }, [started, timeLeft, won]);

  const finish = (moveCount: number) => {
    setWon(true);
    const stars = moveCount <= Math.round(puzzle.scrambleMoves * 1.05) ? 3 : moveCount <= Math.round(puzzle.scrambleMoves * 1.2) ? 2 : 1;
    const save: CampaignSave = {
      unlocked: Math.max(campaign.unlocked, Math.min(LAST_LEVEL, level + 1)),
      stars: { ...campaign.stars, [level]: Math.max(campaign.stars[level] ?? 0, stars) },
      bestMoves: { ...campaign.bestMoves, [level]: Math.min(best ?? Number.POSITIVE_INFINITY, moveCount) },
    };
    setCampaign(save);
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* The level remains playable without local storage. */ }
  };

  const moveTile = (index: number) => {
    if (won || failed || !canSlideTile(tiles, index, puzzle.size)) return;
    const next = slideTile(tiles, index);
    const nextMoves = moves + 1;
    setStarted(true);
    setTiles(next);
    setMoves(nextMoves);
    if (isNumberSlideSolved(next)) finish(nextMoves);
    else if (nextMoves >= moveLimit) setFailed(true);
  };

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (won || failed) return;
      const empty = tiles.indexOf(0);
      const movesByKey: Record<string, number> = {
        ArrowUp: empty - puzzle.size,
        ArrowDown: empty + puzzle.size,
        ArrowLeft: empty - 1,
        ArrowRight: empty + 1,
      };
      const target = movesByKey[event.key];
      if (target === undefined) return;
      event.preventDefault();
      if (target >= 0 && target < tiles.length && canSlideTile(tiles, target, puzzle.size)) moveTile(target);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tiles, puzzle.size, won, failed, moves]);

  const changeLevel = (nextLevel: number) => {
    const next = createNumberSlide(`${seed}:level:${nextLevel}`, nextLevel);
    setLevel(nextLevel);
    setTiles(next.tiles);
    setMoves(0);
    setWon(false);
    setFailed(false);
    setStarted(false);
    const nextTime = next.size === 3 ? 110 - (nextLevel - 1) * 12 : next.size === 4 ? 270 - (nextLevel - 4) * 22 : 480 - (nextLevel - 9) * 25;
    setTimeLeft(nextTime);
  };
  const restart = () => { setTiles(puzzle.tiles); setMoves(0); setWon(false); setFailed(false); setStarted(false); setTimeLeft(timeLimit); };
  const copySeed = async () => {
    try { await navigator.clipboard.writeText(boardSeed); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }
    catch { setCopied(false); }
  };
  const onBoardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key.startsWith("Arrow")) event.preventDefault();
  };
  const stars = campaign.stars[level] ?? 0;

  return (
    <div className="settlement-puzzle numberslide-game">
      <div className="campaign-bar">
        <div className="campaign-chapter"><span>SETTLEMENT CAMPAIGN</span><b>NUMBER SLIDE</b><small>{formatSize(puzzle.size)} BOARD · LEVEL {String(level).padStart(2, "0")}</small></div>
        <div className="campaign-level"><span>LEVEL</span><b>{String(level).padStart(2, "0")}<small> / {LAST_LEVEL}</small></b></div>
        <div className="campaign-progress" aria-label={`${completed} of ${LAST_LEVEL} levels complete`}>
          {Array.from({ length: LAST_LEVEL }, (_, index) => <i key={index} className={index + 1 < campaign.unlocked ? "is-done" : index + 1 === campaign.unlocked ? "is-current" : ""} />)}
        </div>
        <div className="campaign-score"><Trophy size={15} /><b>{starsTotal}</b><span>/ {LAST_LEVEL * 3}</span></div>
      </div>

      <div className="number-slide-help"><span>HOW TO PLAY</span><p>Slide a tile into the empty space. Put the numbers in order, with the empty space last.</p><small>The clock starts on your first move. Each board has a time limit and move budget.</small></div>
      <div className="number-slide-board-wrap">
        <div className="number-slide-board" style={{ "--slide-size": puzzle.size } as CSSProperties} role="group" aria-label={`${formatSize(puzzle.size)} number slide board`} onKeyDown={onBoardKeyDown}>
          {tiles.map((value, index) => {
            const empty = value === 0;
            const movable = !won && !failed && !empty && canSlideTile(tiles, index, puzzle.size);
            return <button key={index} className={`number-tile ${empty ? "is-empty" : ""} ${movable ? "is-movable" : ""}`} onClick={() => moveTile(index)} disabled={!movable} aria-label={empty ? "Empty space" : `Tile ${value}${movable ? ", can slide" : ""}`}>
              {!empty && <span>{value}</span>}
            </button>;
          })}
        </div>
        <div className="number-slide-goal"><span>ARRANGE IN ORDER</span><div>{Array.from({ length: puzzle.size * puzzle.size - 1 }, (_, index) => <i key={index}>{index + 1}</i>)}<i className="goal-empty">□</i></div></div>
      </div>

      <div className="number-slide-controls">
        <div className="puzzle-stat"><span>MOVES</span><b>{String(moves).padStart(2, "0")}</b></div>
        <div className="puzzle-stat"><span>MOVES LEFT</span><b className={moveLimit - moves <= 5 ? "moves-low" : ""}>{String(Math.max(0, moveLimit - moves)).padStart(2, "0")}</b></div>
        <div className="puzzle-stat"><span>TIME LEFT</span><b className={timeLeft <= 15 ? "moves-low" : ""}>{`${String(Math.floor(timeLeft / 60)).padStart(2, "0")}:${String(timeLeft % 60).padStart(2, "0")}`}</b></div>
        <div className="puzzle-stat"><span>BEST</span><b>{best ?? "—"}</b></div>
        <div className="puzzle-actions"><button onClick={restart} disabled={(moves === 0 && !failed) || won} title="Restart this board"><RotateCcw size={15} /> Restart</button></div>
        <span className="keyboard-hint"><kbd>←</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>→</kbd> OR TAP A TILE</span>
      </div>
      <div className="slide-time-track"><i className={timeLeft <= 15 ? "is-low" : ""} style={{ width: `${(timeLeft / timeLimit) * 100}%` }} /></div>

      <div className="puzzle-proof"><span><i className={confirmed ? "proof-dot" : "proof-dot is-muted"} /> {confirmed ? `SETTLEMENT #${blockHeight}` : "PRACTICE BOARD"} · HASH-SHUFFLED</span><button onClick={copySeed}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "COPIED" : "COPY SEED"}</button></div>

      {won && <div className="puzzle-win"><div className="win-spark"><Trophy size={23} fill="currentColor" /></div><div><span>LEVEL {String(level).padStart(2, "0")} CLEAR · {stars} / 3 STARS</span><b>Board solved.</b><small>Personal best: {campaign.bestMoves[level] ?? moves} moves.</small></div>{level < LAST_LEVEL ? <button className="next-level-button" onClick={() => changeLevel(level + 1)}>NEXT BOARD <ArrowUpRight size={14} /></button> : <a href={transactionUrl} target="_blank" rel="noreferrer">View settlement <ArrowUpRight size={14} /></a>}</div>}
      {failed && <div className="slide-fail-overlay"><span>{timeLeft === 0 ? "TIME EXPIRED" : "MOVE LIMIT REACHED"}</span><b>This board is locked.</b><p>Restart for a fresh timed attempt on the same settlement board.</p><button onClick={restart}><RotateCcw size={15} /> TRY AGAIN</button></div>}
      <div className="puzzle-footnote">Each settlement hash creates a shared, solvable scramble. Every level has a clock and a move budget.</div>
    </div>
  );
}
