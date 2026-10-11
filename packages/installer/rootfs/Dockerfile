# Agent sandbox rootfs, exported as a tarball for `wsl --import blueprint-agent`.
#   docker build -t blueprint-agent packages/installer/rootfs
#   docker export $(docker create blueprint-agent) | gzip > blueprint-agent.tar.gz
FROM alpine:3.24

# Harness versions Blueprint is tested against; the portal offers the same pins for up/downgrades.
COPY harness-versions.json /etc/blueprint/harness-versions.json

# util-linux-misc: `script`, which gives `claude setup-token` the pty it needs.
RUN apk add --no-cache bash git curl ca-certificates nodejs npm ripgrep jq iptables ip6tables \
      bind-tools libstdc++ libgcc util-linux-misc \
 && npm install -g --no-fund --no-audit \
      $(jq -r '.[] | "\(.package)@\(.pin)"' /etc/blueprint/harness-versions.json) \
 && rm -rf /root/.npm /tmp/* \
 && adduser -D -s /bin/bash agent \
 && mkdir -p /workspace /data/rust-items-json \
 && chown agent:agent /workspace

# Built from packages/cli (bun build --compile --target=bun-linux-x64-musl).
COPY bot /usr/local/bin/bot
COPY egress-firewall /usr/local/sbin/egress-firewall
COPY egress-allow.txt /etc/egress-allow.txt
COPY wsl.conf /etc/wsl.conf

RUN chmod 755 /usr/local/bin/bot /usr/local/sbin/egress-firewall
