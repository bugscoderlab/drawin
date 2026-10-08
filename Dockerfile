# drawin — all-in-one image for the ladder-drawing server.
# Node 22 + Inkscape (PDF→SVG, keeps text) + poppler (fallback/​text tools).
# Zero npm deps — nothing to install beyond the system packages.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      inkscape poppler-utils fontconfig fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

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
