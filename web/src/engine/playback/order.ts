import type { CanonicalScore, Navigation } from "../domain/types";

// Expands repeats, voltas, D.C./D.S., To Coda and Fine into the measures
// actually played (APP_DESIGN.md §7.6 FR-PLAY-002). After a D.C./D.S. jump
// repeats are not taken again and only the last ending of a volta group
// plays. Expansion is capped at 16× the notated length, so malformed
// structure can never loop forever.
const MAX_OCCURRENCE_FACTOR = 16;

interface Structure {
  forward: boolean[];
  backward: number[];
  endingNum: (number[] | null)[];
  endingEnd: number[];
  nav: Navigation[];
}

export function measureCount(score: CanonicalScore): number {
  return Math.max(0, ...(score.Parts ?? []).map((p) => (p.Measures ?? []).length));
}

function mergeNavigation(a: Navigation, b: Navigation): Navigation {
  const out: Navigation = {};
  const pick = (x?: string, y?: string) => x || y || undefined;
  const segno = pick(a.Segno, b.Segno);
  const coda = pick(a.Coda, b.Coda);
  const dalSegno = pick(a.DalSegno, b.DalSegno);
  const toCoda = pick(a.ToCoda, b.ToCoda);
  if (segno) out.Segno = segno;
  if (coda) out.Coda = coda;
  if (dalSegno) out.DalSegno = dalSegno;
  if (toCoda) out.ToCoda = toCoda;
  if (a.DaCapo || b.DaCapo) out.DaCapo = true;
  if (a.Fine || b.Fine) out.Fine = true;
  return out;
}

function parseEndingNumbers(s: string): number[] {
  const out = s
    .split(/[, ]/)
    .filter((f) => /^[+-]?\d+$/.test(f))
    .map(Number)
    .filter((v) => v > 0);
  return out.length ? out : [1];
}

function buildStructure(score: CanonicalScore): Structure {
  const n = measureCount(score);
  const st: Structure = {
    forward: Array(n).fill(false),
    backward: Array(n).fill(0),
    endingNum: Array(n).fill(null),
    endingEnd: Array(n).fill(-1),
    nav: Array.from({ length: n }, () => ({})),
  };
  (score.Parts ?? []).forEach((part, pi) => {
    let open: number[] | null = null;
    let openAt = -1;
    const measures = part.Measures ?? [];
    measures.forEach((m, i) => {
      st.nav[i] = mergeNavigation(st.nav[i], m.Navigation ?? {});
      if (pi > 0) return; // barlines: the first part is authoritative
      for (const bl of m.Barlines ?? []) {
        if (bl.Repeat === "forward") st.forward[i] = true;
        if (bl.Ending && bl.Ending.Type === "start") {
          open = parseEndingNumbers(bl.Ending.Numbers);
          openAt = i;
        }
      }
      st.endingNum[i] = open;
      for (const bl of m.Barlines ?? []) {
        if (bl.Repeat === "backward") st.backward[i] = Math.max(bl.Times, 2);
        if (bl.Ending && (bl.Ending.Type === "stop" || bl.Ending.Type === "discontinue") && openAt >= 0) {
          st.endingEnd[openAt] = i;
          open = null;
          openAt = -1;
        }
      }
    });
    if (openAt >= 0) st.endingEnd[openAt] = measures.length - 1;
  });
  return st;
}

function findTarget(nav: Navigation[], label: string, get: (n: Navigation) => string | undefined): number {
  let first = -1;
  for (let i = 0; i < nav.length; i++) {
    const v = get(nav[i]);
    if (v) {
      if (v === label) return i;
      if (first < 0) first = i;
    }
  }
  return first;
}

function shouldSkipEnding(st: Structure, i: number, pass: number, jumped: boolean): boolean {
  if (jumped) {
    const next = st.endingEnd[i] + 1;
    return next < st.endingEnd.length && st.endingEnd[next] >= 0;
  }
  return !(st.endingNum[i] ?? []).includes(pass);
}

export function performanceOrder(score: CanonicalScore): number[] {
  const st = buildStructure(score);
  const n = st.nav.length;
  const limit = n * MAX_OCCURRENCE_FACTOR;
  const order: number[] = [];
  const taken = Array(n).fill(0);
  const jumpUsed = Array(n).fill(false);
  let repeatStart = 0;
  let pass = 1;
  let jumped = false;
  for (let i = 0; i < n && order.length < limit; ) {
    if (st.forward[i] && i !== repeatStart) {
      repeatStart = i;
      pass = 1;
    }
    if (st.endingEnd[i] >= 0 && shouldSkipEnding(st, i, pass, jumped)) {
      i = st.endingEnd[i] + 1;
      continue;
    }
    order.push(i);
    const nav = st.nav[i];
    if (jumped && nav.Fine) break;
    if (jumped && nav.ToCoda) {
      const target = findTarget(st.nav, nav.ToCoda, (x) => x.Coda);
      if (target > i) {
        i = target;
        continue;
      }
    }
    const times = st.backward[i];
    if (times > 0 && !jumped && taken[i] < times - 1) {
      taken[i]++;
      pass++;
      i = repeatStart;
      continue;
    }
    if (st.backward[i] > 0) {
      repeatStart = i + 1;
      pass = 1;
    }
    if ((nav.DaCapo || nav.DalSegno) && !jumpUsed[i]) {
      jumpUsed[i] = true;
      const target = nav.DaCapo ? 0 : Math.max(0, findTarget(st.nav, nav.DalSegno!, (x) => x.Segno));
      jumped = true;
      pass = 1;
      repeatStart = target;
      i = target;
      continue;
    }
    i++;
  }
  return order;
}
