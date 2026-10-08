# drawin — all-in-one image for the ladder-drawing server.
# Ubuntu 26.04 for the toolchain the suite is verified against (Inkscape 1.4.x,
# poppler 26.x — bookworm's Inkscape 1.2 / poppler 22 shift corpus extraction
# results). Node 22 is copied from the official image. Zero runtime npm deps —
# nothing to install beyond the system packages.
FROM node:22-bookworm-slim AS node
FROM ubuntu:26.04

COPY --from=node /usr/local /usr/local

# font-rename helper, baked into /usr/local/bin before the apt layer uses it
COPY scripts/make-arialmt-fonts.py /usr/local/bin/make-arialmt-fonts.py

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      inkscape poppler-utils ghostscript fontconfig fonts-dejavu-core fonts-liberation \
      python3 python3-fonttools \
    && python3 /usr/local/bin/make-arialmt-fonts.py /usr/share/fonts/truetype /usr/local/share/fonts/arialmt \
    && DEBIAN_FRONTEND=noninteractive apt-get purge -y python3-fonttools \
    && DEBIAN_FRONTEND=noninteractive apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f >/dev/null 2>&1

# The corpus PDFs name "ArialMT"; stock Linux lacks it and Inkscape then
# outlines all text (see VPS-NOTES.md / wiki/Conversion.md). The step above
# installs fonts literally NAMED ArialMT (Liberation Sans renamed in the
# name table) — a fontconfig alias is not enough for Inkscape's PDF import,
# which matches the embedded font name exactly.

RUN useradd --create-home node

ENV NODE_ENV=production \
    PORT=8123 \
    HOME=/home/node
WORKDIR /app

# templates/ + preview/ are baked in so editors work on first boot;
# docker-compose mounts named volumes over them so runtime uploads persist.
COPY --chown=node:node . /app

USER node
EXPOSE 8123

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8123)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "bin/ladder.mjs", "serve", "8123"]
