export type RescueCandidate = {
  name: string;
  distanceMiles: number;
  coldStorage: boolean;
  acceptsCategory: boolean;
  householdsServed: number;
  capacityLbs: number;
  requiredStorage: "ambient" | "refrigerated" | "frozen";
  pounds: number;
  minutesRemaining: number;
};

export function scoreRescue(candidate: RescueCandidate) {
  const urgency = Math.max(0, Math.min(100, 100 - candidate.minutesRemaining / 4));
  const storageFit = candidate.requiredStorage === "ambient" || candidate.coldStorage;
  const fit = storageFit && candidate.acceptsCategory && candidate.capacityLbs >= candidate.pounds ? 100 : 0;
  const distance = Math.max(0, 100 - candidate.distanceMiles * 12);
  const demand = Math.min(100, candidate.householdsServed);
  const volunteer = candidate.pounds <= 250 ? 100 : 55;
  const score = Math.round(urgency * 0.35 + fit * 0.25 + distance * 0.2 + demand * 0.1 + volunteer * 0.1);
  return {
    score,
    eligible: fit === 100,
    explanation: `${candidate.distanceMiles.toFixed(1)} miles away · ${storageFit ? "storage ready" : "no cold-chain capacity"} · serves ${candidate.householdsServed} households · ${candidate.acceptsCategory ? "accepts this food" : "category mismatch"}`,
  };
}
