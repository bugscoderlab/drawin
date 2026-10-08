#!/usr/bin/env python3
"""Produce fonts literally NAMED ArialMT from Liberation Sans.

The corpus PDFs embed the font name "ArialMT". Inkscape's PDF import matches
that name against installed fonts exactly, so stock Linux (which has no font
by that name) outlines all text instead of emitting a <text> layer
(see VPS-NOTES.md and wiki/Conversion.md). Renaming the family in the name
table — Liberation Sans is metrically compatible with Arial — reproduces in
the image what the verified host has in /usr/local/share/fonts/arialmt/.

Usage: make-arialmt-fonts.py <font-root> <dst-dir>
  <font-root>: directory tree searched recursively for LiberationSans-*.ttf
"""
import sys
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._n_a_m_e import NameRecord

STYLES = {
    "LiberationSans-Regular.ttf": ("Regular", ""),
    "LiberationSans-Bold.ttf": ("Bold", "Bold"),
    "LiberationSans-Italic.ttf": ("Italic", "Italic"),
    "LiberationSans-BoldItalic.ttf": ("BoldItalic", "BoldItalic"),
}
# (platformID, platEncID, langID) pairs to cover, matching the source records
_PLATFORMS = ((1, 0, 0), (3, 1, 0x409))


def set_name(font, name_id, value):
    """Set nameID on the platforms the source font carries; add missing ones."""
    existing = {r.platformID for r in font["name"].names if r.nameID == name_id}
    for rec in font["name"].names:
        if rec.nameID == name_id:
            rec.string = value
    for pid, eid, lid in _PLATFORMS:
        if pid not in existing:
            rec = NameRecord()
            rec.nameID, rec.platformID, rec.platEncID, rec.langID = name_id, pid, eid, lid
            rec.string = value
            font["name"].names.append(rec)


src_root, dst_dir = Path(sys.argv[1]), Path(sys.argv[2])
dst_dir.mkdir(parents=True, exist_ok=True)

found = [p for p in sorted(src_root.rglob("LiberationSans-*.ttf")) if p.name in STYLES]
if not found:
    sys.exit(f"make-arialmt-fonts: no LiberationSans fonts found under {src_root}")

for src in found:
    style, file_suffix = STYLES[src.name]
    font = TTFont(src)
    # Match the verified host layout: family + preferred family "ArialMT",
    # full name and PostScript name plain "ArialMT", unique ID "ArialMT-custom".
    set_name(font, 1, "ArialMT")            # family
    set_name(font, 16, "ArialMT")           # preferred family (typographic)
    set_name(font, 17, style)               # preferred subfamily
    set_name(font, 4, "ArialMT")            # full name
    set_name(font, 6, "ArialMT")            # PostScript name
    set_name(font, 3, "ArialMT-custom")     # unique ID
    dst = dst_dir / f"ArialMT{'' if not file_suffix else '-' + file_suffix}.ttf"
    font.save(dst)
    print(f"{src.name} -> {dst}")
