# Deployment

**Live instance: http://187.53.132.86:8123** (single VPS, Docker Compose).

Full app runs on a single Linux VPS via Docker Compose — one container
(Node 22 + Inkscape + poppler). No domain required; reached by IP over HTTP.
This mirrors the `shipment-tracker` hosting method.

## One-time VPS setup (as root)

The repo is **private**, so two keys are involved:

1. **VPS → GitHub (deploy key):** lets the VPS clone/pull the repo.
   `scripts/vps-setup.sh` generates it at `~/.ssh/drawin_deploy_key` and prints
   the public key — add it under repo **Settings → Deploy keys** (read-only).
2. **GitHub Actions → VPS (CI key):** lets the runner SSH in to deploy.
   Generate a keypair locally, append the public key to the VPS's
   `~/.ssh/authorized_keys`, and store the private key as the `VPS_SSH_KEY`
   repo secret (with `VPS_HOST`, `VPS_USER`).

Then:

```sh
scp scripts/vps-setup.sh root@<vps-ip>:/root/
ssh root@<vps-ip> bash /root/vps-setup.sh <vps-ip>
```

This clones `bugscoderlab/drawin` into `~/drawin` and runs `docker compose up -d --build`.

## Every deploy after that

Push to `main`. GitHub Actions (`.github/workflows/ci.yml`) syntax-checks the
sources, then SSHes into the VPS, `git pull`s, and rebuilds:
`docker compose up -d --build`.

Repo secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`.

## Optional hardening (recommended on a public IP)

Scaffolding runs Inkscape on uploaded PDFs, so a public endpoint should require a token:

1. Generate a token and put it in the **gitignored** `.env` on the VPS
   (`/root/drawin/.env`): `UPLOAD_TOKEN=<long-random-string>`
2. Redeploy (`docker compose up -d`). Compose interpolates `.env` automatically.
3. The upload page probes `/config`; when a token is required it prompts once
   and remembers it in `localStorage`, sending it as the `x-upload-token` header
   on `POST /scaffold` and `POST /bind`. Wrong/expired token → re-prompt.
4. With a domain later, front with Caddy for TLS and keep the token.

## Runtime data

`templates/` and `preview/` are named volumes — scaffolded templates and
generated editors survive redeploys. The repo copy seeds them on first boot.
No database. Scaffolding uses Inkscape only unless you opt in (below); the
LLM key is never needed on the server.

## Optional: LLM-assisted scaffold on the server

By default the server scaffolds rules-only (deterministic). To let the
server-side scaffold run the LLM passes (vision dims, formulas, part-binding
proposals), put the key in the gitignored `.env` next to `docker-compose.yml`:

```
LADDER_LLM_PROVIDER=gemini
GEMINI_API_KEY=...
LADDER_LLM_MODEL=gemini-3.5-flash-lite   # optional
```

`docker compose` interpolates the `LADDER_LLM_*`/provider key vars into the
container's environment (same mechanism as `UPLOAD_TOKEN`); the image itself
never carries secrets (`.dockerignore` excludes `.env`). The upload page
shows an **LLM connected** pill when a key resolves. Run scaffolds where the
key lives (locally or CI) if you prefer the server to stay keyless.
