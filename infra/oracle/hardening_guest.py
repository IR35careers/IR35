"""Fixed Ubuntu24 ARM staging hardening. Public inputs only; JSON output only."""
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import pwd
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
import uuid

ROOT = Path("/var/lib/ir35-hardening")
MOUNT = "/opt/ir35/data"


def run(args, timeout=60, accepted=(0,), env=None):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=env)
    if result.returncode not in accepted:
        raise RuntimeError("Host command failed: " + Path(args[0]).name + "; exit=" + str(result.returncode) + "; raw output suppressed")
    return result.stdout


def public_config(value):
    if set(value) != {"uuid", "ownerCIDR", "bastionCIDR", "publicKey"} or str(uuid.UUID(value["uuid"])) != value["uuid"]:
        raise RuntimeError("Invalid fixed public hardening input")
    for field in ("ownerCIDR", "bastionCIDR"):
        net = ipaddress.ip_network(value[field], strict=True)
        if net.version != 4 or net.prefixlen != 32:
            raise RuntimeError("SSH sources must be exact IPv4 /32")
        if field == "ownerCIDR" and not net.network_address.is_global:
            raise RuntimeError("Owner source must be public")
        if field == "bastionCIDR" and net.network_address not in ipaddress.ip_network("10.35.1.0/24"):
            raise RuntimeError("Bastion source must be the approved private endpoint")
    if not re.fullmatch(r"ssh-ed25519 [A-Za-z0-9+/=]{68}(?: [^\r\n]{1,100})?", value["publicKey"]):
        raise RuntimeError("Only the approved public Ed25519 key is accepted")
    return value


def write(path, text, mode=0o644):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink() or path.exists() and not path.is_file():
        raise RuntimeError("Unsafe hardening file type")
    if path.exists() and path.read_text() == text:
        os.chmod(path, mode)
        return
    if path.exists():
        backup = ROOT / (path.as_posix().strip("/").replace("/", "_") + ".original")
        if not backup.exists():
            descriptor = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(descriptor, "w") as stream:
                stream.write(path.read_text())
    descriptor, temporary = tempfile.mkstemp(prefix=".ir35-", dir=path.parent)
    with os.fdopen(descriptor, "w") as stream:
        os.fchmod(stream.fileno(), mode)
        stream.write(text)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def mount_proof(config):
    fields = run(["findmnt", "--noheadings", "--output", "UUID,FSTYPE,TARGET", "--mountpoint", MOUNT]).strip().split()
    if fields != [config["uuid"], "ext4", MOUNT]:
        raise RuntimeError("Data mount identity mismatch; no hardening or Docker start")
    return True


def platform(config):
    if os.geteuid() != 0 or os.uname().machine != "aarch64":
        raise RuntimeError("Root on the approved ARM64 staging guest required")
    release = dict(line.split("=", 1) for line in Path("/etc/os-release").read_text().splitlines() if "=" in line)
    if release.get("ID") != "ubuntu" or release.get("VERSION_ID", "").strip('"') != "24.04":
        raise RuntimeError("Ubuntu24.04 platform required")
    mount_proof(config)


def audit(config):
    platform(config)
    if (Path("/etc/docker/daemon.json").exists() or Path("/home/ir35").exists()) and not (ROOT / "public-config.json").exists():
        raise RuntimeError("Unexpected existing Docker/deploy-user configuration; review before modification")
    return {"status": "PASS", "architecture": "aarch64", "dataMount": True,
            "dockerInstalled": shutil.which("docker") is not None, "cloudCreates": 0, "productionChanges": 0}


def install(config):
    platform(config)
    environment = {**os.environ, "DEBIAN_FRONTEND": "noninteractive", "NEEDRESTART_MODE": "l"}
    run(["apt-get", "update", "-q"], timeout=300, env=environment)
    run(["apt-get", "install", "-y", "--no-install-recommends", "ca-certificates", "curl", "gnupg", "ufw",
         "fail2ban", "unattended-upgrades", "chrony"], timeout=600, env=environment)
    run(["install", "-d", "-m", "0755", "/etc/apt/keyrings"])
    # Official HTTPS public signing key, scoped by Signed-By to Docker only.
    run(["curl", "--fail", "--silent", "--show-error", "--proto", "=https", "--tlsv1.2",
         "https://download.docker.com/linux/ubuntu/gpg", "--output", "/etc/apt/keyrings/docker.asc"])
    os.chmod("/etc/apt/keyrings/docker.asc", 0o644)
    run(["gpg", "--batch", "--show-keys", "/etc/apt/keyrings/docker.asc"])
    write("/etc/apt/sources.list.d/ir35-docker.sources", "Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: noble\nComponents: stable\nArchitectures: arm64\nSigned-By: /etc/apt/keyrings/docker.asc\n")
    run(["apt-get", "update", "-q"], timeout=300, env=environment)
    run(["apt-get", "install", "-y", "--no-install-recommends", "docker-ce", "docker-ce-cli", "containerd.io",
         "docker-buildx-plugin", "docker-compose-plugin"], timeout=600, env=environment)
    return {"installed": True, "architecture": "arm64", "paidServices": 0}


def docker_guard(identifier):
    return """#!/usr/bin/python3
import subprocess,sys
r=subprocess.run(['findmnt','-n','-o','UUID,FSTYPE,TARGET','--mountpoint','/opt/ir35/data'],capture_output=True,text=True)
sys.exit(0 if r.returncode == 0 and r.stdout.split() == [%r,'ext4','/opt/ir35/data'] else 1)
""" % identifier


def firewall_script(interface):
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,32}", interface):
        raise RuntimeError("Invalid WAN interface")
    return """#!/bin/sh
set -eu
iptables -N IR35-CONTAINERS 2>/dev/null || iptables -S IR35-CONTAINERS >/dev/null
iptables -F IR35-CONTAINERS
iptables -A IR35-CONTAINERS -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
iptables -A IR35-CONTAINERS -i %s -p tcp -m conntrack --ctorigdstport 80 -j RETURN
iptables -A IR35-CONTAINERS -i %s -p tcp -m conntrack --ctorigdstport 443 -j RETURN
iptables -A IR35-CONTAINERS -i %s -j DROP
iptables -A IR35-CONTAINERS -j RETURN
iptables -C DOCKER-USER -j IR35-CONTAINERS 2>/dev/null || iptables -I DOCKER-USER 1 -j IR35-CONTAINERS
""" % (interface, interface, interface)


def restrict_platform_ssh(text, owner, bastion):
    result = []
    for line in text.splitlines():
        fields = shlex.split(line) if line.startswith("-A ") else []
        is_ssh = (fields[:2] == ["-A", "INPUT"] and "--dport" in fields
                  and fields[fields.index("--dport") + 1] == "22" and fields[-2:] == ["-j", "ACCEPT"])
        broad = is_ssh and ("-s" not in fields or fields[fields.index("-s") + 1] in ("0.0.0.0/0", "::/0"))
        if not broad:
            result.append(line)
            continue
        if "-s" in fields:
            index = fields.index("-s")
            fields = fields[:index] + fields[index + 2:]
        result.extend(shlex.join([*fields[:2], "-s", source, *fields[2:]]) for source in (owner, bastion))
    return "\n".join(result) + "\n"


def ufw_order_script():
    return """#!/bin/sh
set -eu
for tool in iptables ip6tables; do
  chain=ufw-before-input
  if [ "$tool" = ip6tables ]; then chain=ufw6-before-input; fi
  $tool -C INPUT -j "$chain"
  $tool -D INPUT -j "$chain"
  $tool -I INPUT 1 -j "$chain"
done
"""


def ufw_ipv6_defaults(text):
    lines = text.splitlines()
    indexes = [index for index, line in enumerate(lines) if line.startswith("IPV6=")]
    if len(indexes) != 1 or lines[indexes[0]] not in ("IPV6=yes", "IPV6=no"):
        raise RuntimeError("Unexpected UFW IPv6 configuration; no guessed replacement")
    lines[indexes[0]] = "IPV6=yes"
    return "\n".join(lines) + "\n"


def firewall_order(config):
    platform(config)
    if json.loads((ROOT / "public-config.json").read_text()) != config:
        raise RuntimeError("Recorded hardening target differs")
    # Enabling UFW's IPv6 filter does not assign an IPv6 address or allow SSH.
    defaults = Path("/etc/default/ufw")
    write(defaults, ufw_ipv6_defaults(defaults.read_text()))
    write("/usr/local/sbin/ir35-ufw-order", ufw_order_script(), 0o755)
    write("/etc/systemd/system/ufw.service.d/ir35-order.conf", "[Unit]\nAfter=netfilter-persistent.service\n[Service]\nExecStartPost=/usr/local/sbin/ir35-ufw-order\n")
    run(["systemctl", "daemon-reload"])
    run(["ufw", "reload"])
    run(["/usr/local/sbin/ir35-ufw-order"])
    return {"ufwBeforePlatformReject": True, "broadSshAdded": False, "iamChanges": 0}


def public_tcp_ports(text):
    ports = []
    for line in text.splitlines():
        address = line.split()[3]
        host, port = address.rsplit(":", 1)
        host = host.strip("[]").split("%", 1)[0]
        try:
            loopback = ipaddress.ip_address(host).is_loopback
        except ValueError:
            loopback = False
        if not loopback:
            ports.append(int(port))
    return sorted(set(ports))


def diagnose_firewall(config):
    platform(config)
    result = {}
    for tool in ("iptables", "ip6tables"):
        checks = {}
        chain = "ufw6-before-input" if tool == "ip6tables" else "ufw-before-input"
        for name, arguments in (("input", ["-S", "INPUT"]), ("ufwChain", ["-S", chain]),
                                ("ufwJump", ["-C", "INPUT", "-j", chain])):
            observed = subprocess.run([tool, *arguments], capture_output=True, text=True, timeout=10)
            checks[name + "Exit"] = observed.returncode
            if name == "input" and observed.returncode == 0:
                lines = observed.stdout.splitlines()
                checks["inputRuleCount"] = sum(line.startswith("-A ") for line in lines)
                policy = lines[0].split()[-1] if lines else "missing"
                checks["inputPolicy"] = policy if policy in ("ACCEPT", "DROP") else "other"
        result[tool] = checks
    result["ufwUnitActive"] = run(["systemctl", "is-active", "ufw"], accepted=(0, 3)).strip()
    result["imageFirewallRestoreActive"] = run(["systemctl", "is-active", "netfilter-persistent"], accepted=(0, 3, 4)).strip()
    result["ufwConfiguredEnabled"] = "ENABLED=yes" in Path("/etc/ufw/ufw.conf").read_text()
    result["ufwIPv6Configured"] = "IPV6=yes" in Path("/etc/default/ufw").read_text()
    result["ipv6Disabled"] = Path("/proc/sys/net/ipv6/conf/all/disable_ipv6").read_text().strip() == "1"
    result["globalIPv6AddressCount"] = sum(len(row.get("addr_info", [])) for row in json.loads(run(["ip", "-j", "-6", "address", "show", "scope", "global"])))
    result["ufwRuntimeActive"] = run(["ufw", "status"]).startswith("Status: active")
    return result


def ssh_settings(text):
    allowed = {"permitrootlogin", "passwordauthentication", "kbdinteractiveauthentication", "authenticationmethods", "allowusers"}
    result = {}
    for line in text.splitlines():
        fields = line.split()
        if fields and fields[0] in allowed:
            result.setdefault(fields[0], []).extend(fields[1:])
    return result


def swap_rows(text):
    result = []
    for line in text.splitlines():
        fields = line.split()
        if len(fields) != 2 or not fields[0].startswith("/") or not fields[1].isdigit():
            raise RuntimeError("Unexpected swap metadata; no ignored row")
        result.append({"name": fields[0], "size": int(fields[1])})
    return result


def swaps():
    return swap_rows(run(["swapon", "--show=NAME,SIZE", "--bytes", "--noheadings", "--raw"]))


def diagnose_controls(config):
    platform(config)
    info = json.loads(run(["docker", "info", "--format", "{{json .}}"] ))
    ufw = run(["ufw", "status", "verbose"])
    return {"ssh": ssh_settings(run(["/usr/sbin/sshd", "-T"])),
        "ufwDefault": next((line for line in ufw.splitlines() if line.startswith("Default:")), "missing"),
        "ufwSshRuleCount": sum(bool(re.match(r"22(?:/tcp)?\s", line)) for line in ufw.splitlines()),
        "swaps": swaps(),
        "swappiness": run(["sysctl", "-n", "vm.swappiness"]).strip(),
        "services": {name: run(["systemctl", "is-active", name], accepted=(0, 3)).strip()
                     for name in ("docker", "fail2ban", "unattended-upgrades", "chrony")},
        "docker": {key: info.get(key) for key in ("DockerRootDir", "LoggingDriver", "ServerVersion")},
        "timezone": run(["timedatectl", "show", "--property=Timezone", "--value"]).strip(),
        "ntp": run(["timedatectl", "show", "--property=NTPSynchronized", "--value"]).strip(),
        "publicTCPPorts": public_tcp_ports(run(["ss", "-H", "-ltn"]))}


def unused_rpc_guard(filesystems, listeners):
    if any(value in ("nfs", "nfs4") for value in filesystems.split()):
        raise RuntimeError("NFS mount present; RPC must not be disabled automatically")
    if listeners.strip() and not all('("rpcbind",' in line for line in listeners.splitlines()):
        raise RuntimeError("Port111 is not exclusively rpcbind; no guessed service change")


def disable_unused_rpc(config):
    platform(config)
    listeners = run(["ss", "-H", "-ltnp", "sport = :111"])
    unused_rpc_guard(run(["findmnt", "--raw", "--noheadings", "--output", "FSTYPE"]), listeners)
    if listeners.strip():
        run(["systemctl", "disable", "--now", "rpcbind.socket", "rpcbind.service"])
    if run(["ss", "-H", "-ltn", "sport = :111"]).strip():
        raise RuntimeError("RPC listener remains; no host signoff")
    return {"unusedRpcListenerDisabled": True, "nfsMounts": 0, "dataChanges": 0}


def configure(config):
    platform(config)
    marker = ROOT / "public-config.json"
    if marker.exists() and json.loads(marker.read_text()) != config:
        raise RuntimeError("Recorded hardening identity differs; no replacement")
    if not marker.exists():
        try:
            pwd.getpwnam("ir35")
        except KeyError:
            pass
        else:
            raise RuntimeError("Unowned pre-existing ir35 account; no modification")
        write(marker, json.dumps(config), 0o600)
    try:
        account = pwd.getpwnam("ir35")
    except KeyError:
        run(["useradd", "--create-home", "--user-group", "--shell", "/bin/bash", "ir35"])
        account = pwd.getpwnam("ir35")
    if account.pw_uid == 0 or account.pw_dir != "/home/ir35":
        raise RuntimeError("Unexpected deploy account identity")
    run(["passwd", "--lock", "ir35"])
    ssh = Path("/home/ir35/.ssh")
    ssh.mkdir(mode=0o700, exist_ok=True)
    if ssh.is_symlink():
        raise RuntimeError("Unsafe SSH directory")
    write(ssh / "authorized_keys", config["publicKey"] + "\n", 0o600)
    for path in (ssh, ssh / "authorized_keys"):
        os.chown(path, account.pw_uid, account.pw_gid)
    os.chmod(ssh, 0o700)
    groups = run(["id", "-nG", "ir35"]).split()
    if groups != ["ir35"]:
        raise RuntimeError("Deploy user must not have sudo/root-equivalent Docker groups")
    run(["install", "-d", "-m", "0750", "-o", "ir35", "-g", "ir35", "/opt/ir35"])
    write("/etc/ssh/sshd_config.d/00-ir35.conf", "PermitRootLogin no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitEmptyPasswords no\nPubkeyAuthentication yes\nAuthenticationMethods publickey\nAllowUsers ubuntu ir35\nAllowAgentForwarding no\nAllowTcpForwarding local\nGatewayPorts no\nX11Forwarding no\n")
    run(["/usr/sbin/sshd", "-t"])
    run(["timedatectl", "set-timezone", "UTC"])
    run(["systemctl", "enable", "--now", "chrony"])
    write("/etc/apt/apt.conf.d/20auto-upgrades", 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n')
    write("/etc/apt/apt.conf.d/52ir35-no-auto-reboot", 'Unattended-Upgrade::Automatic-Reboot "false";\n')
    write("/etc/fail2ban/jail.d/ir35-sshd.local", "[sshd]\nenabled = true\nbackend = systemd\nbanaction = ufw\nmaxretry = 5\nfindtime = 10m\nbantime = 1h\n")
    swap = Path("/swapfile")
    if not swap.exists():
        run(["fallocate", "-l", "4294967296", str(swap)])
        os.chmod(swap, 0o600)
        run(["mkswap", str(swap)])
    if swap.is_symlink() or not stat.S_ISREG(swap.stat().st_mode) or swap.stat().st_size != 4294967296:
        raise RuntimeError("Existing swap file differs; never overwrite")
    os.chmod(swap, 0o600)
    if "/swapfile" not in run(["swapon", "--show=NAME", "--noheadings"]).split():
        run(["swapon", "/swapfile"])
    fstab = Path("/etc/fstab").read_text()
    entries = [line.split() for line in fstab.splitlines() if line.split() and line.split()[0] == "/swapfile"]
    if entries and entries != [["/swapfile", "none", "swap", "sw", "0", "0"]]:
        raise RuntimeError("Conflicting swap fstab; no replacement")
    if not entries:
        write("/etc/fstab", fstab.rstrip() + "\n/swapfile none swap sw 0 0\n")
    write("/etc/sysctl.d/60-ir35-swap.conf", "vm.swappiness=10\n")
    run(["sysctl", "-w", "vm.swappiness=10"])
    # No reset/flush of the image's firewall. Add exact UFW rules first.
    run(["ufw", "default", "deny", "incoming"])
    run(["ufw", "default", "allow", "outgoing"])
    run(["ufw", "default", "deny", "routed"])
    for source in (config["ownerCIDR"], config["bastionCIDR"]):
        run(["ufw", "allow", "from", source, "to", "any", "port", "22", "proto", "tcp"])
    for port in ("80", "443"):
        run(["ufw", "allow", port + "/tcp"])
    run(["ufw", "--force", "enable"])
    # OCI's image can retain an INPUT REJECT ahead of UFW's generated hooks.
    # Make UFW user rules (and fail2ban's prepended denies) effective first,
    # before removing the image's broad SSH exception. Persist via ufw unit.
    firewall_order(config)
    # Remove only the platform's broad SSH accept, preserving every other rule.
    for binary in ("iptables", "ip6tables"):
        for line in run([binary, "-S", "INPUT"]).splitlines():
            fields = shlex.split(line)
            if fields[:2] == ["-A", "INPUT"] and "--dport" in fields and fields[fields.index("--dport") + 1] == "22" and fields[-2:] == ["-j", "ACCEPT"]:
                if "-s" not in fields or fields[fields.index("-s") + 1] in ("0.0.0.0/0", "::/0"):
                    run([binary, "-D", "INPUT", *fields[2:]])
    persistent = Path("/etc/iptables/rules.v4")
    if persistent.exists():
        write(persistent, restrict_platform_ssh(persistent.read_text(), config["ownerCIDR"], config["bastionCIDR"]))
    ipv6 = Path("/etc/iptables/rules.v6")
    if ipv6.exists() and "--dport 22" in ipv6.read_text():
        raise RuntimeError("Existing persistent IPv6 SSH rule needs review; no broad IPv6 SSH allowed")
    if run(["docker", "ps", "-aq"]).strip() or run(["docker", "image", "ls", "-q"]).strip():
        raise RuntimeError("Docker must have no existing containers/images before data-root preparation")
    run(["systemctl", "stop", "docker.socket", "docker.service"])
    write("/etc/docker/daemon.json", json.dumps({"data-root": MOUNT + "/docker", "log-driver": "json-file",
        "log-opts": {"max-size": "10m", "max-file": "3"}, "live-restore": True, "ipv6": False}))
    routes = json.loads(run(["ip", "-j", "route", "show", "default"]))
    if len(routes) != 1:
        raise RuntimeError("Ambiguous default network interface")
    write("/usr/local/sbin/ir35-data-ready", docker_guard(config["uuid"]), 0o755)
    write("/usr/local/sbin/ir35-container-firewall", firewall_script(routes[0]["dev"]), 0o755)
    write("/etc/systemd/system/docker.service.d/ir35-data.conf", "[Unit]\nRequiresMountsFor=/opt/ir35/data\n[Service]\nExecStartPre=/usr/local/sbin/ir35-data-ready\nExecStartPost=/usr/local/sbin/ir35-container-firewall\n")
    run(["systemctl", "daemon-reload"])
    run(["systemctl", "enable", "--now", "docker", "fail2ban", "unattended-upgrades"])
    run(["systemctl", "restart", "fail2ban"])
    run(["systemctl", "reload", "ssh"])
    return {"configured": True, "environmentFilesCreated": 0, "containersCreated": 0}


def verify(config):
    platform(config)
    sshd = ssh_settings(run(["/usr/sbin/sshd", "-T"]))
    ssh_ok = all(sshd.get(k) == v for k, v in {"permitrootlogin": ["no"], "passwordauthentication": ["no"],
        "kbdinteractiveauthentication": ["no"], "authenticationmethods": ["publickey"], "allowusers": ["ubuntu", "ir35"]}.items())
    if not ssh_ok:
        raise RuntimeError("Effective SSH configuration mismatch")
    ufw = run(["ufw", "status", "verbose"])
    if "Status: active" not in ufw or "Default: deny (incoming), allow (outgoing), deny (routed)" not in ufw:
        raise RuntimeError("UFW default policy is not enforced")
    ssh_lines = [line for line in ufw.splitlines() if re.match(r"22(?:/tcp)?\s", line)]
    if len(ssh_lines) != 2 or not all(any(source.split("/")[0] in line for line in ssh_lines) for source in (config["ownerCIDR"], config["bastionCIDR"])):
        raise RuntimeError("UFW SSH sources differ from the two approved /32 sources")
    broad = run(["iptables", "-S", "INPUT"])
    first_rule = next((line for line in broad.splitlines() if line.startswith("-A INPUT ")), "")
    if first_rule != "-A INPUT -j ufw-before-input":
        raise RuntimeError("UFW must precede the platform's terminal input rejection")
    ipv6_rules = run(["ip6tables", "-S", "INPUT"]).splitlines()
    if next((line for line in ipv6_rules if line.startswith("-A INPUT ")), "") != "-A INPUT -j ufw6-before-input":
        raise RuntimeError("IPv6 UFW input hook must be first")
    if any("--dport 22" in line and line.endswith("-j ACCEPT") and " -s " not in line for line in broad.splitlines()):
        raise RuntimeError("Broad host SSH accept remains")
    if run(["sysctl", "-n", "vm.swappiness"]).strip() != "10":
        raise RuntimeError("Swappiness mismatch")
    active_swaps = swaps()
    if not any(row.get("name") == "/swapfile" and row.get("size", 0) >= 4294963200 for row in active_swaps):
        raise RuntimeError("4GiB swap is not active")
    services = {name: run(["systemctl", "is-active", name]).strip() for name in ("docker", "fail2ban", "unattended-upgrades", "chrony")}
    if any(value != "active" for value in services.values()):
        raise RuntimeError("Required hardening service not active")
    run(["fail2ban-client", "status", "sshd"])
    run(["/usr/local/sbin/ir35-data-ready"])
    info = json.loads(run(["docker", "info", "--format", "{{json .}}"], accepted=(0,)))
    if info.get("DockerRootDir") != MOUNT + "/docker" or info.get("LoggingDriver") != "json-file":
        raise RuntimeError("Docker data root/log driver mismatch")
    daemon = json.loads(Path("/etc/docker/daemon.json").read_text())
    if daemon.get("log-opts") != {"max-size": "10m", "max-file": "3"}:
        raise RuntimeError("Docker log rotation mismatch")
    run(["iptables", "-C", "DOCKER-USER", "-j", "IR35-CONTAINERS"])
    if " -j DROP" not in run(["iptables", "-S", "IR35-CONTAINERS"]):
        raise RuntimeError("Docker forwarded-port protection missing")
    zone = run(["timedatectl", "show", "--property=Timezone", "--value"]).strip()
    synchronized = run(["timedatectl", "show", "--property=NTPSynchronized", "--value"]).strip() == "yes"
    if zone != "UTC" or not synchronized:
        raise RuntimeError("UTC/NTP synchronization not yet verified")
    ports = public_tcp_ports(run(["ss", "-H", "-ltn"]))
    if set(ports) - {22, 80, 443}:
        raise RuntimeError("Unexpected public TCP listener; no staging deployment")
    return {"status": "PASS", "architecture": "aarch64", "os": "Ubuntu24.04", "dataMount": True,
        "rootLogin": False, "passwordLogin": False, "sshSourcesExactSlash32": True, "ufw": "active",
        "swapBytes": Path("/swapfile").stat().st_size, "swappiness": 10, "services": services,
        "timezone": zone, "ntpSynchronized": synchronized,
        "dockerVersion": info.get("ServerVersion"), "composeVersion": run(["docker", "compose", "version", "--short"]).strip(),
        "dockerRootOnDataVolume": True, "dockerMountFailClosed": True, "dockerLogs": {"maxSize": "10m", "maxFiles": 3},
        "publicTCPPorts": sorted(set(ports)), "containers": len(run(["docker", "ps", "-aq"]).split()),
        "ir35Groups": run(["id", "-nG", "ir35"]).split(), "productionChanges": 0}


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ("audit", "install", "configure", "verify", "repair-firewall-order", "diagnose-firewall", "diagnose-controls", "disable-unused-rpc"):
        raise RuntimeError("Fixed hardening operation only")
    config = public_config(json.loads(sys.argv[2]))
    if ROOT.is_symlink():
        raise RuntimeError("Unsafe hardening state directory")
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(ROOT, 0o700)
    descriptor = os.open(ROOT / "lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps({"audit": audit, "install": install, "configure": configure, "verify": verify,
                          "repair-firewall-order": firewall_order, "diagnose-firewall": diagnose_firewall,
                          "diagnose-controls": diagnose_controls, "disable-unused-rpc": disable_unused_rpc}[sys.argv[1]](config)))
    finally:
        os.close(descriptor)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error) if isinstance(error, RuntimeError) else "Hardening helper failed; raw output suppressed"}))
        raise SystemExit(1)
