"""Fail closed on any effective-access drift; more-permissive differences halt repair."""
import json

ROLES = {"anon", "authenticated", "service_role"}


def compare(source, target):
    def index(value):
        if value.get("version") != 1 or set(value.get("roles", [])) != ROLES:
            raise ValueError("Complete three-role matrix required")
        result = {}
        for row in value["entries"]:
            if set(row) != {"kind", "name", "role", "privileges"} or row["role"] not in ROLES:
                raise ValueError("Invalid privilege entry")
            if not row["privileges"] or any(type(v) is not bool for v in row["privileges"].values()):
                raise ValueError("Boolean privileges required")
            key = (row["kind"], row["name"], row["role"])
            if key in result:
                raise ValueError("Duplicate privilege key")
            result[key] = row
        if not result or {row["role"] for row in result.values()} != ROLES:
            raise ValueError("Empty/incomplete privilege matrix")
        for kind, name, _ in result:
            if any((kind, name, role) not in result for role in ROLES):
                raise ValueError("Object missing a role")
        return result
    a, b = index(source), index(target)
    differences = []
    more = []
    for key in sorted(a.keys() | b.keys()):
        left, right = a.get(key), b.get(key)
        if not left or not right:
            differences.append({"kind": key[0], "name": key[1], "role": key[2], "cloudPresent": bool(left), "clonePresent": bool(right)})
            if right and any(right["privileges"].values()):
                more.append(differences[-1])
            continue
        for privilege in sorted(left["privileges"].keys() | right["privileges"].keys()):
            cloud, clone = left["privileges"].get(privilege), right["privileges"].get(privilege)
            if cloud is clone:
                continue
            row = {"kind": key[0], "name": key[1], "role": key[2], "privilege": privilege, "cloud": cloud, "clone": clone}
            differences.append(row)
            if clone is True and cloud is not True:
                more.append(row)
    return {"status": "FAIL" if differences else "PASS", "sourceCheckedAt": source["checkedAt"],
        "targetCheckedAt": target["checkedAt"], "sourceEntries": len(a), "targetEntries": len(b),
        "differences": differences, "morePermissive": more, "repairMustStop": bool(more),
        "sourceWrites": 0, "stagingWrites": 0, "exceptionsApproved": []}
