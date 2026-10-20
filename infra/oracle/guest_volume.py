"""Controlled guest data-volume operations; no OCI/cloud/application secrets."""
import json
import os
import subprocess
import sys


def inspect():
    result = subprocess.run(["lsblk", "--json", "--bytes", "--output", "NAME,PATH,TYPE,SIZE,FSTYPE,UUID,MOUNTPOINTS,PKNAME,SERIAL,WWN"],
                            capture_output=True, text=True, check=True, timeout=10)
    return {"architecture": os.uname().machine, "blockdevices": json.loads(result.stdout)["blockdevices"]}


def main():
    if sys.argv[1:] != ["inspect"]:
        raise RuntimeError("Only read-only guest inspect is enabled at this checkpoint")
    print(json.dumps(inspect()))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error) if isinstance(error, RuntimeError) else "Guest command failed; raw output suppressed"}))
        raise SystemExit(1)
