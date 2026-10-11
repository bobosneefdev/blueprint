# Agent sandbox rootfs, exported as a tarball for `wsl --import blueprint-agent`.
#   docker build -t blueprint-agent packages/installer/rootfs
#   docker export $(docker create blueprint-agent) | gzip > blueprint-agent.tar.gz
FROM alpine:3.24

RUN apk add --no-cache bash git curl ca-certificates nodejs npm ripgrep jq iptables ip6tables \
      bind-tools libstdc++ libgcc \
 && npm install -g --no-fund --no-audit \
      @anthropic-ai/claude-code @openai/codex @earendil-works/pi-coding-agent \
 && adduser -D -s /bin/bash agent \
 && mkdir -p /workspace /data/rust-items-json \
 && chown agent:agent /workspace

# Built from packages/cli (bun build --compile --target=bun-linux-x64-musl).
COPY bot /usr/local/bin/bot
COPY egress-firewall /usr/local/sbin/egress-firewall
COPY egress-allow.txt /etc/egress-allow.txt
COPY wsl.conf /etc/wsl.conf

RUN chmod 755 /usr/local/bin/bot /usr/local/sbin/egress-firewall
