// DOM-free SVG renderer — ported from the original HTML generator.
// renderSVG(module, params) -> { svg, viewBox, landscape, ariaLabel, readouts, error? }
// `svg` is the INNER content of the <svg> element (as the original set innerHTML).

import { esc, num, fmt, text, line, dimensionX, dimensionY, commonDefs, isoDate } from './text.mjs';
import { overall, cageModel } from './derive.mjs';
import { CAGE_APPROVAL_IMG, CAGE_LOGO_IMG } from './assets.js';

const S = (v) => String(v ?? '');

export function renderCat(p, opts = {}) {
  const date = opts.date ?? isoDate();
  const rungCount = Math.max(3, Math.min(30, Math.round(num(p.rungs))));
  const total = overall(p);
  const ladderTop = 184, ladderBottom = 790, h = ladderBottom - ladderTop;
  const left = 205, right = 332, sideX = 500;
  const firstY = ladderBottom - (num(p.bottom) / total) * h;
  const lastY = ladderTop + (num(p.top) / total) * h;
  const rungYs = Array.from({ length: rungCount }, (_, i) => firstY - i * ((firstY - lastY) / (rungCount - 1)));
  const centers = Math.max(0, Math.min(6, Math.round(num(p.centres))));
  const centerYs = Array.from({ length: centers }, (_, i) => ladderTop + (i + 1) * h / (centers + 1));
  const rungs = rungYs.map((y) => `<rect x="${left + 9}" y="${y - 4}" width="${right - left - 18}" height="8" rx="2" fill="#23313d"/>`).join('');
  const sideDots = rungYs.map((y) => `<circle cx="${sideX}" cy="${y}" r="3.5" fill="#23313d"/>`).join('');
  const brackets = centerYs.map((y) => `<g><rect x="${sideX - 3}" y="${y - 7}" width="45" height="14" fill="#9db3c2" stroke="#17283a"/><circle cx="${sideX + 34}" cy="${y}" r="2" fill="#17283a"/></g>`).join('');
  const warning = total > 5000 ? 'OVER 5,000 MM - REFER TO NAR' : 'PRELIMINARY - NAR RULE CONFIRMATION REQUIRED';

  const svg = `
      ${commonDefs()}
      <rect x="18" y="18" width="758" height="1087" fill="#fff" stroke="#17283a" stroke-width="2"/>
      <rect x="34" y="34" width="726" height="1055" fill="none" stroke="#17283a"/>
      ${text(55, 69, 'LADDERTECH SDN BHD', 18, 700)}${text(55, 88, 'ALUMINIUM CAT LADDER BODY TYPE', 11, 700)}
      ${text(739, 68, 'WORKING LOAD', 9, 700, 'end')}${text(739, 88, S(p.load).toUpperCase(), 15, 700, 'end')}
      ${line(55, 105, 739, 105)}
      ${text(55, 131, 'FRONT ELEVATION', 10, 700)}${text(440, 131, 'SIDE ELEVATION', 10, 700)}
      <g>
        <rect x="${left}" y="${ladderTop}" width="18" height="${h}" rx="7" fill="#9db3c2" stroke="#17283a" stroke-width="1.6"/>
        <rect x="${right - 18}" y="${ladderTop}" width="18" height="${h}" rx="7" fill="#9db3c2" stroke="#17283a" stroke-width="1.6"/>
        ${rungs}
        ${dimensionY(170, ladderTop, ladderBottom, `${fmt(total)} mm`)}
        ${dimensionY(361, rungYs[Math.max(0, rungYs.length - 2)], rungYs[rungYs.length - 1], `${fmt(num(p.spacing))} mm TYP.`)}
        ${line(left, 814, right, 814, 'marker-start="url(#arrow)" marker-end="url(#arrow)"')}
        ${line(left, 798, left, 824)}${line(right, 798, right, 824)}${text((left + right) / 2, 838, `${fmt(num(p.width))} mm OUTSIDE`, 11, 700, 'middle')}
        ${text((left + right) / 2, 867, `${rungCount} RUNGS`, 13, 700, 'middle')}
      </g>
      <g>
        <rect x="${sideX - 7}" y="${ladderTop}" width="14" height="${h}" rx="6" fill="#9db3c2" stroke="#17283a" stroke-width="1.6"/>
        ${sideDots}${brackets}
        <path d="M${sideX} ${ladderTop} h42 v-19" fill="none" stroke="#17283a" stroke-width="9" stroke-linejoin="round"/>
        <path d="M${sideX} ${ladderBottom} h42 v19" fill="none" stroke="#17283a" stroke-width="9" stroke-linejoin="round"/>
        ${text(560, ladderTop + 7, S(p.bracketDepth).toUpperCase() + ' ELBOW BRACKET', 10, 700)}
        ${text(560, ladderBottom + 5, S(p.bracketDepth).toUpperCase() + ' ELBOW BRACKET', 10, 700)}
        ${centers ? text(560, centerYs[0] + 4, `${centers} CENTRE BRACKET${centers > 1 ? 'S' : ''}`, 10, 700) : ''}
      </g>
      <rect x="55" y="900" width="684" height="54" fill="#fff4df" stroke="#d5ae6c"/>
      ${text(68, 922, warning, 10, 700)}${text(68, 943, S(p.notes), 8.5, 400)}
      <rect x="55" y="974" width="684" height="91" fill="none" stroke="#17283a"/>
      ${line(430, 974, 430, 1065)}${line(55, 1019, 739, 1019)}${line(585, 1019, 585, 1065)}
      ${text(68, 994, 'Customer', 8, 700)}${text(68, 1011, S(p.customer), 10, 700)}
      ${text(445, 994, 'Drawing No.', 8, 700)}${text(445, 1011, S(p.drawingNo), 9, 700)}
      ${text(600, 994, 'Revision', 8, 700)}${text(672, 1011, S(p.revision), 10, 700)}
      ${text(68, 1039, 'Material', 8, 700)}${text(130, 1039, S(p.material), 9, 700)}
      ${text(250, 1039, 'Finishing', 8, 700)}${text(315, 1039, S(p.finish), 9, 700)}
      ${text(445, 1039, 'Date', 8, 700)}${text(485, 1039, date, 9, 700)}
      ${text(600, 1039, 'Unit', 8, 700)}${text(672, 1039, 'mm', 9, 700)}
      ${text(68, 1057, 'Generated for quotation review. Final fabrication drawing requires NAR approval.', 8, 400)}
      ${text(739, 1082, '© Laddertech Sdn Bhd', 8, 400, 'end')}`;

  return { svg, viewBox: '0 0 794 1123', landscape: false, ariaLabel: 'Generated cat ladder technical drawing', readouts: { overall: `${fmt(total)} mm` } };
}

export function renderTrolley(p, opts = {}) {
  const date = opts.date ?? isoDate();
  const stepCount = Math.max(3, Math.min(20, Math.round(num(p.steps))));
  const platformH = num(p.platformHeight), guardH = num(p.guardrailHeight), overallH = platformH + guardH;
  const baseY = 545, platformY = 230, scale = (baseY - platformY) / Math.max(platformH, 1);
  const sideLeft = 118, sidePlatformEnd = 275, stairFoot = 470;
  const treadYs = Array.from({ length: stepCount }, (_, i) => baseY - (i + 1) * (baseY - platformY) / (stepCount + 0.15));
  const treadSide = treadYs.map((y) => { const t = (baseY - y) / (baseY - platformY); const x = stairFoot - t * (stairFoot - sidePlatformEnd); return `<path d="M${x - 17} ${y}h40" stroke="#17283a" stroke-width="6"/>`; }).join('');
  const frontLeft = 575, frontRight = 675, frontTop = 230, frontBottom = 545;
  const frontSteps = Array.from({ length: stepCount }, (_, i) => { const y = frontBottom - (i + 1) * (frontBottom - frontTop) / (stepCount + 0.15); return `<rect x="${frontLeft + 7}" y="${y - 4}" width="${frontRight - frontLeft - 14}" height="8" fill="#23313d"/>`; }).join('');
  const title = `ALUMINIUM SAFETY LADDER TROLLEY ${stepCount} STEP (CUSTOMIZED)`;
  const isoSteps = Array.from({ length: stepCount }, (_, i) => { const x = 835 + i * 13, y = 505 - i * 24; return `<path d="M${x} ${y}l63 -18 24 12 -62 19z" fill="#819bb0" stroke="#17283a"/>`; }).join('');

  const svg = `${commonDefs()}
      <rect x="14" y="14" width="1095" height="766" fill="#fff" stroke="#17283a" stroke-width="2"/><rect x="30" y="30" width="1063" height="734" fill="none" stroke="#17283a"/>
      ${text(48, 60, 'LADDERTECH SDN BHD', 17, 700)}${text(48, 80, title, 10, 700)}${text(1076, 60, 'WORKING LOAD', 8, 700, 'end')}${text(1076, 82, '150 KG', 15, 700, 'end')}${line(48, 98, 1076, 98)}
      ${text(85, 124, 'SIDE ELEVATION', 10, 700)}${text(550, 124, 'FRONT ELEVATION', 10, 700)}${text(810, 124, '3D PREVIEW', 10, 700)}
      <g>
        <path d="M${sideLeft} ${baseY}V${platformY}H${sidePlatformEnd}" fill="none" stroke="#6989a7" stroke-width="12"/>
        <path d="M${sidePlatformEnd} ${platformY}L${stairFoot} ${baseY}" fill="none" stroke="#6989a7" stroke-width="14"/>${treadSide}
        <path d="M${sideLeft} ${platformY}v-${Math.min(150, guardH * scale)}h${sidePlatformEnd - sideLeft}v${Math.min(150, guardH * scale)}" fill="none" stroke="#6989a7" stroke-width="8"/>
        <path d="M${sidePlatformEnd + 8} ${platformY + 6}Q${sidePlatformEnd + 30} ${platformY - 42} ${sidePlatformEnd + 50} ${platformY + 8}L${stairFoot + 25} ${baseY - 90}Q${stairFoot + 36} ${baseY - 70} ${stairFoot + 31} ${baseY - 48}" fill="none" stroke="#6989a7" stroke-width="8"/>
        ${line(sideLeft, baseY, stairFoot, baseY)}${line(sideLeft, platformY, stairFoot, baseY)}${line(sideLeft, 420, 360, 420)}${line(sideLeft, baseY, 360, 420)}
        <circle cx="${sideLeft + 10}" cy="${baseY + 7}" r="13" fill="#536b7e" stroke="#17283a"/><circle cx="${stairFoot - 15}" cy="${baseY + 7}" r="13" fill="#536b7e" stroke="#17283a"/>
        ${dimensionY(78, platformY, baseY, `${fmt(platformH)} mm`)}${dimensionY(58, platformY - Math.min(150, guardH * scale), platformY, `${fmt(guardH)} mm`)}${dimensionX(sideLeft, stairFoot, 584, `${fmt(num(p.footprint))} mm`)}${dimensionX(sideLeft, sidePlatformEnd, 190, `${fmt(num(p.platformLength))} mm`)}
        ${text(330, 610, `${stepCount} STEPS · ${fmt(num(p.rise))} MM SPACING`, 10, 700, 'middle')}
      </g>
      <g>
        <rect x="${frontLeft}" y="${frontTop}" width="14" height="${frontBottom - frontTop}" fill="#9db3c2" stroke="#17283a"/><rect x="${frontRight - 14}" y="${frontTop}" width="14" height="${frontBottom - frontTop}" fill="#9db3c2" stroke="#17283a"/>${frontSteps}
        <path d="M${frontLeft} ${frontTop}v-105h${frontRight - frontLeft}v105" fill="none" stroke="#6989a7" stroke-width="8"/><rect x="${frontLeft - 22}" y="${frontBottom}" width="${frontRight - frontLeft + 44}" height="10" fill="#6989a7" stroke="#17283a"/>
        ${dimensionX(frontLeft, frontRight, 584, `${fmt(num(p.trolleyWidth))} mm`)}${text((frontLeft + frontRight) / 2, 610, S(p.castor).toUpperCase(), 9, 700, 'middle')}
      </g>
      <g>
        <path d="M780 520l220 -65 0 18 -220 65z" fill="#6989a7" stroke="#17283a"/><path d="M800 530V260l150-45v270" fill="none" stroke="#6989a7" stroke-width="10"/><path d="M950 215l80 50v260" fill="none" stroke="#6989a7" stroke-width="10"/><path d="M950 485L800 530M950 215L800 260M800 260l150 45 80-40" fill="none" stroke="#17283a" stroke-width="2"/>
        <path d="M950 485L835 505" fill="none" stroke="#6989a7" stroke-width="13"/>${isoSteps}<path d="M950 205v-82l-150 45v92M800 168l150 45 80-25v77" fill="none" stroke="#6989a7" stroke-width="8"/>
        ${text(895, 570, `${S(p.levelers)} ADJUSTABLE LEVELLERS`, 9, 700, 'middle')}${text(895, 588, S(p.handrails).toUpperCase(), 9, 700, 'middle')}
      </g>
      <rect x="48" y="633" width="1028" height="38" fill="#fff4df" stroke="#d5ae6c"/>${text(61, 648, 'MOCKUP DRAWING - DIMENSIONS AND STRUCTURE REQUIRE NAR CONFIRMATION', 9, 700)}${text(61, 664, S(p.trolleyNotes), 7.5, 400)}
      <rect x="48" y="690" width="1028" height="62" fill="none" stroke="#17283a"/>${line(390, 690, 390, 752)}${line(805, 690, 805, 752)}${line(48, 721, 1076, 721)}
      ${text(60, 704, 'Customer', 7, 700)}${text(60, 717, S(p.customer), 9, 700)}${text(404, 704, 'Product', 7, 700)}${text(404, 717, title, 9, 700)}${text(818, 704, 'Drawing No. / Revision', 7, 700)}${text(818, 717, `${S(p.drawingNo)} / ${S(p.revision)}`, 9, 700)}
      ${text(60, 739, `Material: ${S(p.material)}     Finishing: ${S(p.finish)}`, 8, 700)}${text(404, 739, `Height: ${fmt(overallH)} mm     Angle: ${S(p.angle)}`, 8, 700)}${text(818, 739, `Date: ${date}     Unit: mm`, 8, 700)}${text(1076, 772, '© Laddertech Sdn Bhd', 7, 400, 'end')}`;

  return { svg, viewBox: '0 0 1123 794', landscape: true, ariaLabel: 'Generated safety ladder trolley drawing', readouts: { overallHeight: `${fmt(overallH)} mm` } };
}

export function renderCage(p) {
  const m = cageModel(p);
  if (m.error) return { error: m.error };

  const f = (v) => Number(v).toFixed(2), ink = '#141b1d', steel = '#94afb6';
  const t = (x, y, s, size = 7, anchor = 'start', extra = '') => `<text x="${x}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="${size}" fill="#111" text-anchor="${anchor}" ${extra}>${esc(s)}</text>`;
  const ln = (x1, y1, x2, y2, extra = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#111" stroke-width=".5" ${extra}/>`;
  const dy = (x, a, b, label, ext) => ln(x, a, x, b, 'marker-start="url(#cadArrow)" marker-end="url(#cadArrow)"') + ln(x - 5, a, ext, a) + ln(x - 5, b, ext, b) + t(x - 4, (a + b) / 2, label, 7, 'middle', `letter-spacing="1" transform="rotate(-90 ${x - 4} ${(a + b) / 2})"`);
  const dx = (a, b, y, label, ext) => ln(a, y, b, y, 'marker-start="url(#cadArrow)" marker-end="url(#cadArrow)"') + ln(a, ext, a, y + 6) + ln(b, ext, b, y + 6) + t((a + b) / 2, y - 4, label, 7, 'middle', 'letter-spacing="1"');
  const scale = Math.min(800 / m.total, 132 / (m.depth + m.returnDepth), 112 / m.outer), base = 894;
  const sx = 116 + m.returnDepth * scale, fx = 403;
  const side = (q) => [sx + q[1] * scale, base - q[2] * scale];
  const front = (q) => [fx + q[0] * scale, base - q[2] * scale];
  const isoScale = Math.min(690 / (m.total + .35 * m.outer + .3 * m.depth), 155 / (.85 * m.outer + .5 * (m.depth + m.returnDepth)));
  const iso = (q) => [613 + (.85 * q[0] + .5 * q[1]) * isoScale, 806 + (-.34 * q[0] + .30 * q[1] - q[2]) * isoScale];
  const poly = (pts, fill, stroke = ink, width = .45) => `<polygon points="${pts.map((q) => q.join(',')).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"/>`;
  const path = (pts, stroke, width, close = false) => `<path d="M${pts.map((q) => q.join(',')).join('L')}${close ? 'Z' : ''}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
  function box(project, x, y, z, w, d, h) {
    const q = (a, b, c) => project([a, b, c]);
    return poly([q(x, y, z), q(x + w, y, z), q(x + w, y, z + h), q(x, y, z + h)], steel) + poly([q(x + w, y, z), q(x + w, y + d, z), q(x + w, y + d, z + h), q(x + w, y, z + h)], '#6e929d') + poly([q(x, y, z + h), q(x + w, y, z + h), q(x + w, y + d, z + h), q(x, y + d, z + h)], '#b5c9cd');
  }
  function tube(project, pts, s, width = 32, color = steel) {
    const pp = pts.map(project), w = Math.max(1.3, width * s);
    return path(pp, ink, w + .9) + path(pp, color, w) + path(pp, '#d2e0e2', Math.max(.3, w * .17));
  }
  function ringPoints(z) {
    const r = m.outer / 2, cy = m.depth - r, pts = [[-m.width / 2, 14, z], [-r, cy, z]];
    for (let i = 0; i <= 32; i++) { const a = Math.PI - i * Math.PI / 32; pts.push([r * Math.cos(a), cy + r * Math.sin(a), z]); }
    pts.push([m.width / 2, 14, z]); return pts;
  }
  function ring(project, z) {
    const pts = ringPoints(z); let out = '';
    for (let i = 0; i < pts.length - 1; i++) out += poly([project(pts[i]), project(pts[i + 1]), project([pts[i + 1][0], pts[i + 1][1], z + 45]), project([pts[i][0], pts[i][1], z + 45])], steel, 'none', 0);
    out += path(pts.map(project), ink, .4) + path(pts.map((q) => project([q[0], q[1], z + 45])), ink, .4);
    return `<g data-part="ring" data-z="${z}">${out}</g>`;
  }
  function view(name, project, s) {
    let out = `<g data-view="${name}">`;
    for (const x of [-m.width / 2, m.width / 2 - 25]) {
      out += box(project, x, -18, 0, 25, 64, m.landing);
      const pts = [[x + 12, 14, m.landing], [x + 12, 14, m.total - 65]];
      for (let i = 0; i <= 8; i++) { const a = i * Math.PI / 16; pts.push([x + 12, 14 - 65 + 65 * Math.cos(a), m.total - 65 + 65 * Math.sin(a)]); }
      pts.push([x + 12, -m.returnDepth + 65, m.total]);
      for (let i = 0; i <= 8; i++) { const a = i * Math.PI / 16; pts.push([x + 12, -m.returnDepth + 65 - 65 * Math.sin(a), m.total - 65 + 65 * Math.cos(a)]); }
      pts.push([x + 12, -m.returnDepth, m.landing]);
      out += tube(project, pts, s, 32);
      out += box(project, x - 22, -32, 0, 70, 94, 8);
      for (const z of [m.landing + m.handrail * .36, m.landing + m.handrail * .67]) out += box(project, x, -m.returnDepth, z, 22, m.returnDepth + 14, 30);
    }
    for (const z of m.rungZ) {
      const pts = [[-m.width / 2 + 25, 14, z], [m.width / 2 - 25, 14, z]];
      out += `<g data-part="rung" data-z="${z}">${tube(project, pts, s, 26, '#242b2d')}</g>`;
      if (name === 'side') { const q = project([0, 14, z]); out += `<circle cx="${q[0]}" cy="${q[1]}" r="1.15" fill="#111" stroke="#b6d1d5" stroke-width=".3"/>`; }
    }
    for (const z of m.bracketZ) {
      out += `<g data-part="bracket" data-z="${z}">`;
      for (const x of [-m.width / 2 - 10, m.width / 2 - 30]) {
        out += box(project, x, -m.bracketDepth, z - 25, 40, m.bracketDepth + 48, 50);
        out += box(project, x - 10, -m.bracketDepth, z - 40, 60, 10, 80);
        const b = project([x + 20, 43, z]); out += `<circle cx="${b[0]}" cy="${b[1]}" r="1" fill="#273d45"/>`;
      } out += '</g>';
    }
    for (const x of [-m.width / 2, m.width / 2 - 25]) {
      out += box(project, x - 4, 47, m.landing / 2 - 140, 33, 7, 280);
      for (const dz of [-100, -35, 35, 100]) { const b = project([x + 12, 55, m.landing / 2 + dz]); out += `<circle cx="${b[0]}" cy="${b[1]}" r=".7" fill="#111"/>`; }
    }
    for (const z of m.ringZ) out += ring(project, z);
    for (const x of [-m.outer / 2, m.outer / 2]) out += box(project, x - 3, m.depth - m.outer / 2 - 20, m.start, 6, 40, m.height);
    out += box(project, -20, m.depth, m.start, 40, 6, m.height);
    out += '</g>'; return out;
  }
  const top = base - m.total * scale, landing = base - m.landing * scale, cb = base - m.start * scale, ct = base - m.cageTop * scale;
  const leader = (label, x, y, px, py) => t(x, y, label, 7, 'start', 'letter-spacing="1.3" font-weight="bold"') + ln(x + 48, y + 2, px, py, 'marker-end="url(#cadArrow)"');
  const date = S(p.drawingDate).split('-').reverse().join('-');
  const notes = S(p.cageNotes).trim();

  const svg = `<defs><marker id="cadArrow" viewBox="0 0 10 6" markerWidth="7" markerHeight="4" refX="1" refY="3" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M10 0L0 3L10 6L7 3Z" fill="#111"/></marker></defs>
      <rect width="794" height="1123" fill="white"/>
      <rect x="14" y="27" width="766" height="1069" fill="none" stroke="#111" stroke-width=".8"/>
      <rect x="31" y="44" width="732" height="1035" fill="none" stroke="#111" stroke-width=".6"/>
      ${view('side', side, scale)}${view('front', front, scale)}${view('isometric', iso, isoScale)}
      ${dy(70, landing, base, f(m.landing), sx - 5)}${dy(91, top, landing, f(m.handrail), sx - m.returnDepth * scale - 3)}
      ${dy(277, ct, cb, f(m.height), sx + m.depth * scale + 3)}${dy(246, cb, base, f(m.start), sx + m.depth * scale + 3)}
      ${dy(sx + 25, base - m.bottom * scale, base, f(m.bottom), sx + 3)}
      ${dx(sx - m.returnDepth * scale, sx, top - 16, f(m.returnDepth), top - 2)}
      ${dx(fx - m.width / 2 * scale, fx + m.width / 2 * scale, base + 13, f(m.width), base + 1)}
      ${leader('FLATBAR', sx + 5, top + 2, sx - m.returnDepth * .5 * scale, landing - m.handrail * .4 * scale)}
      ${leader('JOINT', 82, base - m.landing / 2 * scale - 28, sx + 3, base - m.landing / 2 * scale)}${t(82, base - m.landing / 2 * scale - 17, 'BRACKET', 7, 'start', 'letter-spacing="1.3" font-weight="bold"')}
      ${m.brackets ? leader(f(m.bracketDepth) + ' mm', 78, base - m.landing * .37 * scale, sx - m.bracketDepth * .7 * scale, base - m.bracketZ[Math.floor(m.brackets / 2)] * scale) + t(78, base - m.landing * .37 * scale + 11, 'CENTRE', 7, 'start', 'letter-spacing="1.3" font-weight="bold"') + t(78, base - m.landing * .37 * scale + 22, 'BRACKET', 7, 'start', 'letter-spacing="1.3" font-weight="bold"') : ''}
      ${leader('FLOOR', 103, base - 29, sx, base - 2)}${t(103, base - 18, 'BRACKET', 7, 'start', 'letter-spacing="1.3" font-weight="bold"')}
      <rect x="568" y="815" width="174" height="87" fill="none" stroke="#111" stroke-width=".6"/>
      ${t(655, 871, 'Approved By', 7, 'middle')}${ln(578, 876, 719, 876, 'stroke-dasharray="1 1.5"')}${t(578, 888, 'Name:', 7)}${t(578, 898, 'Date:', 7)}
      <image x="574" y="907" width="165" height="81" href="${CAGE_APPROVAL_IMG}"/>
      ${S(p.cageLoad).replace(/\s/g, '').toLowerCase() !== '150kg' ? `<rect x="600" y="943" width="29" height="11" fill="#f21124"/>${t(614.5, 951, S(p.cageLoad).toUpperCase(), 6, 'middle', 'style="fill:white" textLength="27" lengthAdjust="spacingAndGlyphs"')}` : ''}
      ${notes ? t(42, 978, notes, 6) : ''}
      ${ln(31, 993, 763, 993)}${ln(318, 993, 318, 1079)}
      <image x="39" y="1015" width="265" height="38" href="${CAGE_LOGO_IMG}"/>
      ${ln(318, 1013, 763, 1013)}${ln(318, 1033, 763, 1033)}${ln(318, 1049, 763, 1049)}${ln(318, 1065, 763, 1065)}
      ${ln(398, 1033, 398, 1079)}${ln(488, 1033, 488, 1079)}${ln(557, 1033, 557, 1079)}${ln(636, 1033, 636, 1079)}
      ${t(326, 1006, 'Customer: ' + S(p.customer), 8)}
      ${t(326, 1026, 'Title: ALUMINIUM CAT LADDER BODY,HANDRAIL & CAGE RING TYPE', 7.6)}
      ${t(336, 1044, 'Drawing No', 6)}${t(443, 1044, S(p.drawingNo), 6, 'middle')}${t(512, 1044, 'Revision', 6)}${t(593, 1044, S(p.revision), 6, 'middle')}
      ${t(339, 1060, 'Material', 6)}${t(443, 1060, S(p.material), 6, 'middle')}${t(515, 1060, 'Date', 6)}${t(594, 1060, date, 6, 'middle')}
      ${t(339, 1075, 'Finishing', 6)}${t(443, 1075, S(p.finish), 6, 'middle')}${t(515, 1075, 'Unit', 6)}${t(594, 1075, 'mm', 6, 'middle')}
      <rect x="636" y="1033" width="127" height="32" fill="white" stroke="#111" stroke-width=".5"/>
      ${t(699, 1043, 'Working Load', 6, 'middle')}${t(699, 1061, S(p.cageLoad).toUpperCase(), 16, 'middle')}${t(699, 1075, 'Page No : 1 of 1', 6, 'middle')}
      ${t(729, 1088, '© Ladder Technology Industrial Sdn Bhd, 2026 All Right Reserved', 5, 'end')}`;

  return {
    svg, viewBox: '0 0 794 1123', landscape: false,
    ariaLabel: 'Parametric safety cage ladder: side, front and isometric views',
    readouts: { overall: `${fmt(m.total)} mm`, summary: `${m.rungZ.length} rungs · ${m.rings} rings · ${m.brackets} bracket levels · Cage top ${fmt(m.cageTop)} mm` },
  };
}

/** Dispatcher. */
export function renderSVG(module, params, opts = {}) {
  if (module === 'trolley') return renderTrolley(params, opts);
  if (module === 'cage') return renderCage(params, opts);
  return renderCat(params, opts);
}

/** Full standalone SVG document (for files / rasterising). */
export function renderDocument(module, params, opts = {}) {
  const r = renderSVG(module, params, opts);
  if (r.error) return r;
  return { ...r, document: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r.viewBox}" width="${r.viewBox.split(' ')[2]}" height="${r.viewBox.split(' ')[3]}" role="img" aria-label="${esc(r.ariaLabel)}">${r.svg}</svg>` };
}
