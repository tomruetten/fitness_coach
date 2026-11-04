// Wandelt eine geplante Laufeinheit (plan.profile) in ein strukturiertes Garmin-Training um.
// Keine KI nötig: der Plan liegt bereits als Abfolge von Abschnitten (Minuten, Art, Tempo) vor.
const STEP = {
  warmup: { stepTypeId: 1, stepTypeKey: 'warmup' },
  cooldown: { stepTypeId: 2, stepTypeKey: 'cooldown' },
  interval: { stepTypeId: 3, stepTypeKey: 'interval' },
  recovery: { stepTypeId: 4, stepTypeKey: 'recovery' },
  repeat: { stepTypeId: 6, stepTypeKey: 'repeat' },
};
const RUN = { sportTypeId: 1, sportTypeKey: 'running' };
const WORK = new Set(['mar', 'thr', 'int', 'rep']);

const same = (a, b) => a.k === b.k && a.m === b.m && a.pace_s === b.pace_s;

/** Zieltempo als Bereich in m/s (Garmin: Wert 1 = schneller, Wert 2 = langsamer). Lockere Abschnitte bekommen mehr Spielraum. */
function target(seg) {
  if (!seg.pace_s) return { targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target' }, targetValueOne: null, targetValueTwo: null };
  const mps = 1000 / seg.pace_s, tol = WORK.has(seg.k) ? 0.04 : 0.08;
  return {
    targetType: { workoutTargetTypeId: 6, workoutTargetTypeKey: 'pace.zone' },
    targetValueOne: Number((mps * (1 + tol)).toFixed(4)),
    targetValueTwo: Number((mps * (1 - tol)).toFixed(4)),
  };
}

function exec(seg, type, order) {
  return {
    type: 'ExecutableStepDTO',
    stepOrder: order,
    stepType: STEP[type],
    endCondition: { conditionTypeId: 2, conditionTypeKey: 'time' },
    endConditionValue: Math.max(1, Math.round(seg.m * 60)),
    ...target(seg),
  };
}

/**
 * @param {{kind:string,title:string,summary?:string,profile?:{m:number,k:string,pace_s:number|null}[]}} plan
 * @returns {object|null} Garmin-Workout oder null, wenn die Einheit kein Lauf mit Ablauf ist
 */
export function planToWorkout(plan) {
  const segs = (plan?.profile || []).filter((s) => s && s.m > 0);
  if (!String(plan?.kind || '').startsWith('run') || !segs.length) return null;
  const quality = plan.kind === 'run_quality' && segs.length > 2;
  const out = [];
  let order = 1;
  for (let i = 0; i < segs.length;) {
    const s = segs[i];
    if (WORK.has(s.k)) {
      let n = 1, j = i;
      while (segs[j + 1]?.k === 'rec' && segs[j + 2] && same(segs[j + 2], s)) { n++; j += 2; }
      if (n >= 2) {
        // n Wiederholungen: (n−1) × [Belastung, Pause] und eine letzte Belastung, damit nach dem Intervall keine zusätzliche Pause entsteht
        out.push({ type: 'RepeatGroupDTO', stepOrder: order++, stepType: STEP.repeat, numberOfIterations: n - 1, smartRepeat: false, workoutSteps: [exec(s, 'interval', 1), exec(segs[i + 1], 'recovery', 2)] });
        out.push(exec(s, 'interval', order++));
        i = j + 1;
        continue;
      }
    }
    const type = s.k === 'rec' ? 'recovery' : quality && i === 0 ? 'warmup' : quality && i === segs.length - 1 ? 'cooldown' : 'interval';
    out.push(exec(s, type, order++));
    i++;
  }
  return {
    workoutName: String(plan.title || 'Lauf').slice(0, 50),
    description: String(plan.summary || '').slice(0, 500),
    sportType: RUN,
    workoutSegments: [{ segmentOrder: 1, sportType: RUN, workoutSteps: out }],
  };
}
