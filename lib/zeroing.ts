export const INCHES_PER_MOA_AT_100_YARDS = 1.047;
export const INCHES_PER_MIL_AT_100_YARDS = 3.6;
export const CM_PER_MIL_AT_100_METERS = 10;
export const METERS_PER_YARD = 0.9144;
export const CM_PER_INCH = 2.54;

export type DistanceUnit = "yards" | "meters";
export type AngularUnit = "MOA" | "MIL";
export type OffsetUnit = "inches" | "centimeters" | "MOA" | "mil";
export type VerticalDirection = "HIGH" | "LOW";
export type HorizontalDirection = "LEFT" | "RIGHT";
export type ReticleType = "FFP" | "SFP" | "unknown";

export type OffsetInput = {
  magnitude?: number;
  unit: OffsetUnit;
  direction: VerticalDirection | HorizontalDirection;
};

export type ZeroingInput = {
  distance: number;
  distanceUnit: DistanceUnit;
  opticUnit: AngularUnit;
  elevationPerClick: number;
  windagePerClick: number;
  vertical?: OffsetInput;
  horizontal?: OffsetInput;
};

export type CorrectionAxis = {
  provided: boolean;
  angularUnit: AngularUnit;
  angularOffset: number;
  exactClicks: number;
  recommendedClicks: number;
  adjustmentDirection: string;
  residual: number;
  residualUnit: "inches" | "centimeters";
  residualDirection: string;
};

export type ZeroingResult = {
  elevation: CorrectionAxis;
  windage: CorrectionAxis;
};

export type ReticleOffsetInput = {
  distance: number;
  distanceUnit: DistanceUnit;
  reticleUnit: AngularUnit;
  reticleType: ReticleType;
  calibrationMagnification?: number;
  currentMagnification?: number;
  horizontal?: { magnitude?: number; direction: HorizontalDirection };
  vertical?: { magnitude?: number; direction: VerticalDirection };
};

export type ReticleAxisResult = {
  provided: boolean;
  observed: number;
  angular: number;
  direction: string;
  inches: number;
  centimeters: number;
};

export type ReticleOffsetResult = {
  horizontal: ReticleAxisResult;
  vertical: ReticleAxisResult;
};

export function convertDistance(value: number, from: DistanceUnit, to: DistanceUnit): number {
  if (from === to) return value;
  return from === "yards" ? value / METERS_PER_YARD : value * METERS_PER_YARD;
}

export function inchesToMOA(inches: number, distanceYards: number): number {
  return inches / (INCHES_PER_MOA_AT_100_YARDS * distanceYards / 100);
}

export function moaToInches(moa: number, distanceYards: number): number {
  return moa * (INCHES_PER_MOA_AT_100_YARDS * distanceYards / 100);
}

export function inchesToMil(inches: number, distanceYards: number): number {
  return inches / (INCHES_PER_MIL_AT_100_YARDS * distanceYards / 100);
}

export function milToInches(mil: number, distanceYards: number): number {
  return mil * (INCHES_PER_MIL_AT_100_YARDS * distanceYards / 100);
}

export function cmToMil(cm: number, distanceMeters: number): number {
  return cm / (CM_PER_MIL_AT_100_METERS * distanceMeters / 100);
}

export function milToCm(mil: number, distanceMeters: number): number {
  return mil * (CM_PER_MIL_AT_100_METERS * distanceMeters / 100);
}

export function applySfpMagnificationCorrection(observed: number, calibrationMagnification: number, currentMagnification: number): number {
  return observed * (calibrationMagnification / currentMagnification);
}

function physicalInches(value: number, unit: OffsetUnit, distance: number, distanceUnit: DistanceUnit): number {
  if (unit === "inches") return value;
  if (unit === "centimeters") return value / CM_PER_INCH;
  const distanceYards = distanceUnit === "yards" ? distance : convertDistance(distance, "meters", "yards");
  return unit === "MOA" ? moaToInches(value, distanceYards) : milToInches(value, distanceYards);
}

function offsetToAngular(value: number, unit: OffsetUnit, distance: number, distanceUnit: DistanceUnit, targetUnit: AngularUnit): number {
  if (unit === targetUnit) return value;
  if (unit === "MOA") {
    const distanceYards = distanceUnit === "yards" ? distance : convertDistance(distance, "meters", "yards");
    return targetUnit === "MIL" ? inchesToMil(moaToInches(value, distanceYards), distanceYards) : value;
  }
  if (unit === "mil") {
    const distanceYards = distanceUnit === "yards" ? distance : convertDistance(distance, "meters", "yards");
    return targetUnit === "MOA" ? inchesToMOA(milToInches(value, distanceYards), distanceYards) : value;
  }
  const inches = physicalInches(value, unit, distance, distanceUnit);
  const distanceYards = distanceUnit === "yards" ? distance : convertDistance(distance, "meters", "yards");
  return targetUnit === "MOA" ? inchesToMOA(inches, distanceYards) : inchesToMil(inches, distanceYards);
}

function axisCorrection(offset: OffsetInput | undefined, distance: number, distanceUnit: DistanceUnit, opticUnit: AngularUnit, perClick: number, firstImpactDirection: string, firstCorrectionDirection: string, secondCorrectionDirection: string, secondImpactDirection: string): CorrectionAxis {
  const magnitude = offset?.magnitude ?? 0;
  const provided = Boolean(offset && Number.isFinite(magnitude) && magnitude > 0);
  if (!offset || !provided) return { provided: false, angularUnit: opticUnit, angularOffset: 0, exactClicks: 0, recommendedClicks: 0, adjustmentDirection: "No adjustment required", residual: 0, residualUnit: distanceUnit === "meters" ? "centimeters" : "inches", residualDirection: "" };
  const angularOffset = offsetToAngular(magnitude, offset.unit, distance, distanceUnit, opticUnit);
  const exactClicks = angularOffset / perClick;
  const recommendedClicks = Math.max(0, Math.round(exactClicks));
  const adjustmentDirection = offset.direction === firstImpactDirection ? firstCorrectionDirection : secondCorrectionDirection;
  const residualAngular = Math.abs(recommendedClicks - exactClicks) * perClick;
  const distanceYards = distanceUnit === "yards" ? distance : convertDistance(distance, "meters", "yards");
  const residualInches = opticUnit === "MOA" ? moaToInches(residualAngular, distanceYards) : milToInches(residualAngular, distanceYards);
  const residual = distanceUnit === "meters" ? residualInches * CM_PER_INCH : residualInches;
  const residualDirection = recommendedClicks > exactClicks ? (adjustmentDirection === firstCorrectionDirection ? secondImpactDirection : firstImpactDirection) : offset.direction;
  return { provided: true, angularUnit: opticUnit, angularOffset, exactClicks, recommendedClicks, adjustmentDirection, residual, residualUnit: distanceUnit === "meters" ? "centimeters" : "inches", residualDirection };
}

export function calculateZeroClicks(input: ZeroingInput): ZeroingResult {
  return {
    elevation: axisCorrection(input.vertical, input.distance, input.distanceUnit, input.opticUnit, input.elevationPerClick, "LOW", "UP", "DOWN", "HIGH"),
    windage: axisCorrection(input.horizontal, input.distance, input.distanceUnit, input.opticUnit, input.windagePerClick, "LEFT", "RIGHT", "LEFT", "RIGHT"),
  };
}

function reticleAxis(magnitude: number | undefined, direction: string, input: ReticleOffsetInput): ReticleAxisResult {
  const provided = Number.isFinite(magnitude) && (magnitude ?? 0) > 0;
  if (!provided) return { provided: false, observed: 0, angular: 0, direction, inches: 0, centimeters: 0 };
  const angular = input.reticleType === "SFP" ? applySfpMagnificationCorrection(magnitude!, input.calibrationMagnification!, input.currentMagnification!) : magnitude!;
  const distanceYards = input.distanceUnit === "yards" ? input.distance : convertDistance(input.distance, "meters", "yards");
  const inches = input.reticleUnit === "MOA" ? moaToInches(angular, distanceYards) : milToInches(angular, distanceYards);
  return { provided: true, observed: magnitude!, angular, direction, inches, centimeters: inches * CM_PER_INCH };
}

export function calculateReticleOffset(input: ReticleOffsetInput): ReticleOffsetResult {
  return {
    horizontal: reticleAxis(input.horizontal?.magnitude, input.horizontal?.direction ?? "LEFT", input),
    vertical: reticleAxis(input.vertical?.magnitude, input.vertical?.direction ?? "LOW", input),
  };
}

export function calculateResidualError(exactClicks: number, recommendedClicks: number, clickValue: number, angularUnit: AngularUnit, distance: number, distanceUnit: DistanceUnit): number {
  const distanceYards = distanceUnit === "yards" ? distance : convertDistance(distance, "meters", "yards");
  const residualAngular = Math.abs(recommendedClicks - exactClicks) * clickValue;
  const inches = angularUnit === "MOA" ? moaToInches(residualAngular, distanceYards) : milToInches(residualAngular, distanceYards);
  return distanceUnit === "meters" ? inches * CM_PER_INCH : inches;
}
