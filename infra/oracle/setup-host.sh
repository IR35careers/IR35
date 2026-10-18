#!/usr/bin/env bash
set -euo pipefail
test "$(dpkg --print-architecture)" = arm64
. /etc/os-release
test "$ID" = ubuntu && test "$VERSION_ID" = 24.04

# Official signed Docker apt repository; no paid service or daemon API exposure.
install -m 0755 -d /etc/apt/keyrings
curl --fail --silent --show-error --location https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod 0644 /etc/apt/keyrings/docker.asc
install -m 0644 /usr/local/share/ir35-docker.sources /etc/apt/sources.list.d/docker.sources
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker compose version
systemctl enable --now docker fail2ban unattended-upgrades

# The cloud-init deploy account is non-root; Docker group access is root-equivalent.
usermod -aG docker ir35deploy
install -d -m 0750 -o ir35deploy -g ir35deploy /opt/ir35-worker
# No .env, database login, cloud resource or application consumer is created here.

if ! test -e /swapfile; then
  fallocate -l 2G /swapfile
  chmod 0600 /swapfile
  mkswap /swapfile
fi
if ! swapon --show=NAME --noheadings | grep -Fxq /swapfile; then swapon /swapfile; fi
if ! grep -Eq '^/swapfile[[:space:]]' /etc/fstab; then
  printf '%s\n' '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sshd -t
systemctl reload ssh
