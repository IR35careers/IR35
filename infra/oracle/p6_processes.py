"""Docker top requires a PID header; retain complete browser/orphan checks."""
PS_FIELDS = 'pid,stat,comm'


def process_rows(output):
    lines = output.splitlines()
    if not lines or lines[0].split() not in (['PID', 'STAT', 'COMMAND'], ['PID', 'STAT', 'COMM']):
        raise RuntimeError('NativeProcessPIDHeaderRequired')
    for line in lines[1:]:
        fields = line.split(maxsplit=2)
        if len(fields) != 3 or not fields[0].isdecimal() or int(fields[0]) <= 0:
            raise RuntimeError('NativeProcessRowInvalid_NoAssumedEmptyList')
    return lines[1:]
