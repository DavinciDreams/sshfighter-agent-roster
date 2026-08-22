// Pure summaries for redacted runner ledgers. Public profile counters are not
// accepted as round totals; official per-match records remain authoritative.
export const LIVE_EVAL_SCHEMA = 'sshfighter-agent-roster/live-eval/v1';

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.round((sorted.length - 1) * fraction)];
}

export function summarizeLiveLedger(rows) {
  const transport = rows.filter((row) => row.kind === 'transport_sample');
  const decisions = rows.filter((row) => row.kind === 'decision');
  const boundaries = rows.filter((row) => row.kind === 'match_boundary');
  const coalesced = rows.filter((row) => row.kind === 'input_suppressed'
    && row.reason === 'decision-in-flight');
  const decisionMs = decisions.map((row) => Number(row.decisionMs)).filter(Number.isFinite);
  const acknowledgments = transport.flatMap((row) => row.newlyAcknowledged ?? []);
  const ackMs = acknowledgments.map((row) => Number(row.ackLatencyMs)).filter(Number.isFinite);
  const observedFrameSpan = transport.reduce((sum, row) => sum + Math.max(1, Number(row.frameDelta) || 0), 0);
  const skippedFrames = transport.reduce((sum, row) => sum + (Number(row.skippedFrames) || 0), 0);
  const official = boundaries.map((row) => row.official?.match).filter(Boolean);
  return {
    schema: LIVE_EVAL_SCHEMA,
    matches: official.map((match) => ({
      id: match.id, winner: match.winner, aRounds: match.a_rounds, bRounds: match.b_rounds,
      endReason: match.end_reason, durationFrames: match.duration_frames,
    })),
    decision: {
      count: decisionMs.length,
      p50Ms: percentile(decisionMs, 0.50),
      p95Ms: percentile(decisionMs, 0.95),
      maxMs: decisionMs.length ? Math.max(...decisionMs) : null,
    },
    transport: {
      stateMessages: transport.length,
      coalescedStateMessages: coalesced.length,
      observedFrameSpan,
      skippedFrames,
      skippedFrameRate: observedFrameSpan ? skippedFrames / observedFrameSpan : null,
      acknowledgedInputs: acknowledgments.length,
      ackP50Ms: percentile(ackMs, 0.50),
      ackP95Ms: percentile(ackMs, 0.95),
      ackMaxMs: ackMs.length ? Math.max(...ackMs) : null,
      ackFrameLagP95: percentile(acknowledgments.map((row) => Number(row.ackFrameLag)), 0.95),
    },
  };
}
