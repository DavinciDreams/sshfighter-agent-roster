export interface MegaInnovationDecision {
  action: Record<string, unknown>;
  reason: string;
  status: Record<string, unknown>;
}

export interface MegaInnovationPolicy {
  decide(state: Record<string, unknown>): MegaInnovationDecision;
  reset(): void;
  status(): Record<string, unknown>;
  rngState(): number;
}

export function createMegaInnovationPolicy(
  profileId: string,
  mode?: string,
  seed?: number,
  overrides?: Record<string, unknown>,
): MegaInnovationPolicy;
