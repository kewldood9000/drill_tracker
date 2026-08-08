import type { PassCriteria, Standard } from "./types";
export const SCORE_VALUES = { alpha: 5, charlie: 3, delta: 1, miss: -10 } as const;
export const calculateAlpha = (maxHits: number, charlie: number, delta: number, miss: number) => Math.max(0, maxHits - charlie - delta - miss);
export const validHitCounts = (maxHits: number, charlie: number, delta: number, miss: number) => [maxHits,charlie,delta,miss].every(Number.isInteger) && maxHits > 0 && charlie >= 0 && delta >= 0 && miss >= 0 && charlie + delta + miss <= maxHits;
export const calculatePoints = (alpha:number, charlie:number, delta:number, miss:number) => alpha*SCORE_VALUES.alpha + charlie*SCORE_VALUES.charlie + delta*SCORE_VALUES.delta + miss*SCORE_VALUES.miss;
export const calculateHitFactor = (points: number, time: number) => Number.isFinite(time) && time > 0 ? points / time : null;
export const determineTimeStandard = (time: number, standards: Standard[]) => { if (!Number.isFinite(time) || time <= 0) return null; return standards.filter(s => Number.isFinite(s.maxTime) && s.maxTime > 0 && time <= s.maxTime).sort((a,b) => a.maxTime - b.maxTime || a.order - b.order)[0] ?? null; };
export const hasPassCriteria = (criteria?: PassCriteria) => Boolean(criteria?.requireAllAlpha || criteria?.maxTime || criteria?.minPoints || criteria?.minHitFactor);
export const evaluatePassCriteria = (criteria: PassCriteria | undefined, score: { time: number; alpha: number; charlie: number; delta: number; miss: number; points: number; hitFactor: number | null }) => {
  if (!hasPassCriteria(criteria)) return null;
  const failed: string[] = [];
  if (criteria?.requireAllAlpha && (score.charlie > 0 || score.delta > 0 || score.miss > 0)) failed.push("All hits must be Alpha");
  if (criteria?.maxTime && (!Number.isFinite(score.time) || score.time <= 0 || score.time > criteria.maxTime)) failed.push(`${criteria.maxTime.toFixed(2)} seconds or faster`);
  if (criteria?.minPoints && score.points < criteria.minPoints) failed.push(`${criteria.minPoints} points or more`);
  if (criteria?.minHitFactor && (score.hitFactor === null || score.hitFactor < criteria.minHitFactor)) failed.push(`Hit factor ${criteria.minHitFactor.toFixed(2)} or higher`);
  return { passed: failed.length === 0, failed };
};
