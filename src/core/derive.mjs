// Pure derived values — extracted from the original HTML generator.
import { num } from './text.mjs';
import { rangeError } from './modules.mjs';

/** Cat-ladder overall length: bottom + (rungs-1)*spacing + top. */
export function overall(p) {
  return num(p.bottom) + Math.max(0, num(p.rungs) - 1) * num(p.spacing) + num(p.top);
}

const CAGE_FIELDS = ['cageLadderHeight', 'cageHandrailHeight', 'cageStartHeight', 'cageHeight', 'cageWidth',
  'cageProjection', 'cageOuterWidth', 'cageHandrailReturn', 'cageRungSpacing', 'cageBottomRung',
  'cageRings', 'cageBrackets', 'cageBracketDepth'];

/** Cage geometry model + validation. Returns {error} or the model `m`. */
export function cageModel(p) {
  const m = {
    landing: num(p.cageLadderHeight), handrail: num(p.cageHandrailHeight), start: num(p.cageStartHeight),
    height: num(p.cageHeight), width: num(p.cageWidth), depth: num(p.cageProjection), outer: num(p.cageOuterWidth),
    returnDepth: num(p.cageHandrailReturn), pitch: num(p.cageRungSpacing), bottom: num(p.cageBottomRung),
    rings: num(p.cageRings), brackets: num(p.cageBrackets), bracketDepth: num(p.cageBracketDepth),
  };
  m.total = m.landing + m.handrail;
  m.cageTop = m.start + m.height;

  for (const f of CAGE_FIELDS) {
    const e = rangeError(f, p[f]);
    if (e) return { error: e };
  }
  if (m.cageTop > m.total + 0.01) return { error: 'Cage start height + cage height must not exceed the total ladder height. Adjust either parameter.' };
  if (m.outer < m.width + 50) return { error: 'Cage outside width must be at least 50 mm wider than the ladder.' };
  if (m.depth < m.outer / 2) return { error: 'Cage projection must be at least half the cage outside width to form the curved rings.' };
  if (m.bottom >= m.landing) return { error: 'Bottom rung clearance must be below the landing.' };

  m.rungZ = Array.from({ length: Math.floor((m.landing - m.bottom) / m.pitch) + 1 }, (_, i) => m.bottom + i * m.pitch);
  if ((m.height - 45) / (m.rings - 1) < 50) return { error: 'Too many cage rings for this cage height. Increase the height or reduce the ring count.' };
  m.ringZ = Array.from({ length: m.rings }, (_, i) => m.start + i * (m.height - 45) / (m.rings - 1));
  m.bracketZ = Array.from({ length: m.brackets }, (_, i) => (i + 1) * m.landing / (m.brackets + 1));
  return m;
}
