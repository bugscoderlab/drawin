#!/usr/bin/env bash
# One-time VPS bootstrap for drawin — follows the shipment-tracker method.
#
# Run as root on the VPS:
#   scp scripts/vps-setup.sh root@<vps-ip>:/root/
#   ssh root@<vps-ip> bash /root/vps-setup.sh <vps-ip>
#
# The repo is private: this script creates a deploy key on the VPS and wires
# ~/.ssh/config to use it for github.com. Add the printed public key as a
# read-only Deploy key under the repo's Settings → Deploy keys before the
# first run (GitHub Actions' VPS_SSH_KEY is a different key — runner → VPS).
set -euo pipefail

IP="${1:-}"
REPO="git@github.com:bugscoderlab/drawin.git"
DIR="$HOME/drawin"

if [ -z "$IP" ]; then
    echo "usage: $0 <vps-ip>" >&2
    exit 1
fi

# --- Docker + git -------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
    echo "==> installing Docker"
    curl -fsSL https://get.docker.com | sh
fi
if ! command -v git >/dev/null 2>&1; then
    echo "==> installing git"
    apt-get update && apt-get install -y git
fi

# --- Deploy key (VPS -> GitHub) ----------------------------------------------
if [ ! -f "$HOME/.ssh/drawin_deploy_key" ]; then
    echo "==> generating VPS deploy key"
    ssh-keygen -t ed25519 -f "$HOME/.ssh/drawin_deploy_key" -N "" -C "drawin-vps-deploy"
fi
if ! grep -qs "Host github.com" "$HOME/.ssh/config" 2>/dev/null; then
    printf 'Host github.com\n  IdentityFile ~/.ssh/drawin_deploy_key\n  StrictHostKeyChecking accept-new\n' >> "$HOME/.ssh/config"
    chmod 600 "$HOME/.ssh/config"
fi
echo "==> add this Deploy key (read-only) at github.com/bugscoderlab/drawin/settings/keys :"
cat "$HOME/.ssh/drawin_deploy_key.pub"

# --- Repo ---------------------------------------------------------------------
if [ -d "$DIR/.git" ]; then
    echo "==> $DIR already cloned, pulling"
    git -C "$DIR" pull --ff-only
else
    echo "==> cloning $REPO into $DIR"
    git clone "$REPO" "$DIR"
fi

# --- Stack --------------------------------------------------------------------
cd "$DIR"
docker compose up -d --build

echo
echo "==> done. app: http://$IP:8123"
echo "==> future deploys: push to main; GitHub Actions runs the deploy."
