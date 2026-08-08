import type { PassCriteria, Standard } from "./types";
export const SCORE_VALUES = { alpha: 5, charlie: 3, delta: 1, miss: -10 } as const;
export const calculateAlpha = (maxHits: number, charlie: number, delta: number, miss: number) => Math.max(0, maxHits - charlie - delta - miss);
export const validHitCounts = (maxHits: number, charlie: number, delta: number, miss: number) => [maxHits,charlie,delta,miss].every(Number.isInteger) && maxHits > 0 && charlie >= 0 && delta >= 0 && miss >= 0 && charlie + delta + miss <= maxHits;
export const calculatePoints = (alpha:number, charlie:number, delta:number, miss:number) => alpha*SCORE_VALUES.alpha + charlie*SCORE_VALUES.charlie + delta*SCORE_VALUES.delta + miss*SCORE_VALUES.miss;
export const calculateHitFactor = (points: number, time: number) => Number.isFinite(time) && time > 0 ? points / time : null;
export const standardMetric = (standard: Standard) => standard.metric ?? "time";
export const determineStandard = (time: number, hitFactor: number | null, standards: Standard[]) => standards.filter(standard => {
  if (!Number.isFinite(standard.maxTime) || standard.maxTime <= 0) return false;
  return standardMetric(standard) === "hitFactor" ? hitFactor !== null && hitFactor >= standard.maxTime : Number.isFinite(time) && time > 0 && time <= standard.maxTime;
}).sort((a, b) => {
  const aMetric = standardMetric(a); const bMetric = standardMetric(b);
  if (aMetric !== bMetric) return a.order - b.order;
  return aMetric === "hitFactor" ? b.maxTime - a.maxTime || a.order - b.order : a.maxTime - b.maxTime || a.order - b.order;
})[0] ?? null;
export const hasPassCriteria = (criteria?: PassCriteria) => Boolean(criteria?.requireAllAlpha || criteria?.maxNonAlpha !== undefined || criteria?.maxTime || criteria?.minPoints || criteria?.minHitFactor);
export const evaluatePassCriteria = (criteria: PassCriteria | undefined, score: { time: number; alpha: number; charlie: number; delta: number; miss: number; points: number; hitFactor: number | null }) => {
  if (!hasPassCriteria(criteria)) return null;
  const failed: string[] = [];
  const maxNonAlpha = criteria?.maxNonAlpha ?? (criteria?.requireAllAlpha ? 0 : undefined); const nonAlpha = score.charlie + score.delta + score.miss;
  if (maxNonAlpha !== undefined && nonAlpha > maxNonAlpha) failed.push(maxNonAlpha === 0 ? "All hits must be Alpha" : `No more than ${maxNonAlpha} non-Alpha hits`);
  if (criteria?.maxTime && (!Number.isFinite(score.time) || score.time <= 0 || score.time > criteria.maxTime)) failed.push(`${criteria.maxTime.toFixed(2)} seconds or faster`);
  if (criteria?.minPoints && score.points < criteria.minPoints) failed.push(`${criteria.minPoints} points or more`);
  if (criteria?.minHitFactor && (score.hitFactor === null || score.hitFactor < criteria.minHitFactor)) failed.push(`Hit factor ${criteria.minHitFactor.toFixed(2)} or higher`);
  return { passed: failed.length === 0, failed };
};
