"""Resolve public official image tags to verified native ARM child digests."""
import hashlib
import json
from pathlib import Path
import urllib.parse
import urllib.request

UPSTREAM = "bc27d2661edd09a5d0b8d76ce33da6d4071a756e"
IMAGES = {"db": ("supabase/postgres", "17.6.1.136"), "auth": ("supabase/gotrue", "v2.197.0"),
    "rest": ("postgrest/postgrest", "v14.18"), "realtime": ("supabase/realtime", "v2.143.3"),
    "storage": ("supabase/storage-api", "v1.81.0"), "kong": ("kong/kong", "3.9.3"),
    "meta": ("supabase/postgres-meta", "v0.100.0"), "studio": ("supabase/studio", "2026.10.12-sha-3699278"),
    "caddy": ("library/caddy", "2.10.2-alpine"), "smtp": ("axllent/mailpit", "v1.27.10")}
ACCEPT = ", ".join(("application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json"))


def fetch(url, headers=None):
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}), timeout=30) as response:
        body = response.read(8 * 1024 * 1024 + 1)
        if len(body) > 8 * 1024 * 1024:
            raise RuntimeError("Registry metadata exceeded bound")
        return json.loads(body), "sha256:" + hashlib.sha256(body).hexdigest(), response.headers


def resolve(repository, tag):
    token, _, _ = fetch("https://auth.docker.io/token?" + urllib.parse.urlencode({"service": "registry.docker.io", "scope": "repository:" + repository + ":pull"}))
    headers = {"Authorization": "Bearer " + token["token"], "Accept": ACCEPT}
    index, digest, response = fetch("https://registry-1.docker.io/v2/" + repository + "/manifests/" + tag, headers)
    if response.get("Docker-Content-Digest") != digest:
        raise RuntimeError("Registry index digest mismatch")
    children = [row for row in index.get("manifests", []) if row.get("platform", {}).get("os") == "linux" and row["platform"].get("architecture") == "arm64"]
    if len(children) != 1:
        raise RuntimeError("Expected one native ARM image manifest: " + repository + ":" + tag)
    child = children[0]["digest"]
    manifest, actual, _ = fetch("https://registry-1.docker.io/v2/" + repository + "/manifests/" + child, headers)
    if actual != child:
        raise RuntimeError("Registry child digest mismatch")
    config, config_digest, _ = fetch("https://registry-1.docker.io/v2/" + repository + "/blobs/" + manifest["config"]["digest"], headers)
    if config_digest != manifest["config"]["digest"] or config.get("os") != "linux" or config.get("architecture") != "arm64":
        raise RuntimeError("Registry config platform/digest mismatch")
    return {"repository": repository, "tag": tag, "indexDigest": digest, "platformDigest": child,
        "image": repository + ":" + tag + "@" + child, "platform": "linux/arm64", "user": config.get("config", {}).get("User", ""),
        "entrypoint": config.get("config", {}).get("Entrypoint", []), "command": config.get("config", {}).get("Cmd", [])}


if __name__ == "__main__":
    try:
        rows = {}
        for service, (repository, tag) in IMAGES.items():
            rows[service] = resolve(repository, tag)
            print("PASS native ARM manifest: " + service + " " + repository + ":" + tag, flush=True)
        path = Path(__file__).with_name("staging-images.json")
        path.write_text(json.dumps({"upstreamCommit": UPSTREAM, "images": rows}, indent=2) + "\n")
    except Exception as error:
        print("STOP: image pinning failed; " + (str(error) if isinstance(error, RuntimeError) else type(error).__name__) + "; registry token/raw response suppressed")
        raise SystemExit(1)
