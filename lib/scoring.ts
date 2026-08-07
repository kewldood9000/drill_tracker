import type { Standard } from "./types";
export const SCORE_VALUES = { alpha: 5, charlie: 3, delta: 1, miss: -10 } as const;
export const calculateAlpha = (maxHits: number, charlie: number, delta: number, miss: number) => Math.max(0, maxHits - charlie - delta - miss);
export const validHitCounts = (maxHits: number, charlie: number, delta: number, miss: number) => [maxHits,charlie,delta,miss].every(Number.isInteger) && maxHits > 0 && charlie >= 0 && delta >= 0 && miss >= 0 && charlie + delta + miss <= maxHits;
export const calculatePoints = (alpha:number, charlie:number, delta:number, miss:number) => alpha*SCORE_VALUES.alpha + charlie*SCORE_VALUES.charlie + delta*SCORE_VALUES.delta + miss*SCORE_VALUES.miss;
export const calculateHitFactor = (points: number, time: number) => Number.isFinite(time) && time > 0 ? points / time : null;
export const determineTimeStandard = (time: number, standards: Standard[]) => { if (!Number.isFinite(time) || time <= 0) return null; return standards.filter(s => Number.isFinite(s.maxTime) && s.maxTime > 0 && time <= s.maxTime).sort((a,b) => a.maxTime - b.maxTime || a.order - b.order)[0] ?? null; };
