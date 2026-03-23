import * as fs from "fs";
import * as path from "path";

const FILE = path.join(process.cwd(), "counters.json");

export interface Counters {
  total_sessions: number;
  total_analyzed: number;
  total_signals: number;
  total_rugs_avoided: number;
  total_mpp_spent: number;
}

const DEFAULT: Counters = {
  total_sessions: 0,
  total_analyzed: 0,
  total_signals: 0,
  total_rugs_avoided: 0,
  total_mpp_spent: 0,
};

export function loadCounters(): Counters {
  try {
    if (fs.existsSync(FILE)) {
      return { ...DEFAULT, ...JSON.parse(fs.readFileSync(FILE, "utf8")) };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT };
}

export function saveCounters(c: Counters): void {
  try {
    fs.writeFileSync(FILE, JSON.stringify(c, null, 2));
  } catch { /* ignore */ }
}

export function saveSession(
  c: Counters,
  sessionStats: {
    analyzed: number;
    signals: number;
    rugsAvoided: number;
    mppSpent: number;
    startTime: number;
  }
): void {
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    fs.writeFileSync(
      `session-${ts}.json`,
      JSON.stringify(
        {
          session_start: new Date(sessionStats.startTime).toISOString(),
          session_end: new Date().toISOString(),
          analyzed: sessionStats.analyzed,
          signals: sessionStats.signals,
          rugs_avoided: sessionStats.rugsAvoided,
          mpp_spent: sessionStats.mppSpent,
          lifetime: c,
        },
        null,
        2
      )
    );
  } catch { /* ignore */ }
}
