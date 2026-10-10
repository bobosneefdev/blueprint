#!/bin/sh
# Runs as root inside a freshly imported Alpine WSL distro. Builds the agent sandbox.
#   wsl -d better-rust-agent -u root -- sh /mnt/setup/setup.sh
# (/mnt/setup is only reachable during provisioning; automount is disabled afterwards.)
set -eu

apk add --no-cache bash git curl ca-certificates nodejs npm ripgrep iptables ip6tables bind-tools libstdc++ libgcc

# Agent user: no sudo, no password, owns only /workspace and its home.
adduser -D -s /bin/bash agent
mkdir -p /workspace /data/rust-items-json
chown agent:agent /workspace
chmod 755 /data/rust-items-json

# Harnesses, installed globally but run as `agent`.
npm install -g --no-fund --no-audit @anthropic-ai/claude-code @openai/codex @earendil-works/pi-coding-agent

# Lock the distro down. Takes effect after `wsl --terminate better-rust-agent`.
cat >/etc/wsl.conf <<'EOF'
[automount]
enabled = false
mountFsTab = false

[interop]
enabled = false
appendWindowsPath = false

[user]
default = agent

[boot]
command = /usr/local/sbin/egress-firewall
EOF

install -m 755 /mnt/setup/egress-firewall /usr/local/sbin/egress-firewall
install -m 644 /mnt/setup/egress-allow.txt /etc/egress-allow.txt
echo "setup ok"
