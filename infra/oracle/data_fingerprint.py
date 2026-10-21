"""Bounded streaming MD5 of every ordered text-cast row, no row logging/files."""
import hashlib
import os
import re
import select
import struct
import subprocess
import time

ALGORITHM='pg17-copy-binary-framed-text-v1'
SETTINGS="SET LOCAL search_path=pg_catalog; SET LOCAL TIME ZONE 'UTC'; SET LOCAL DateStyle='ISO,YMD'; SET LOCAL IntervalStyle='postgres'; SET LOCAL extra_float_digits=3; SET LOCAL bytea_output='hex'; SET LOCAL lc_monetary='C'; SET LOCAL lc_numeric='C'; SET LOCAL lc_time='C';"


def identifier(value):
    if not isinstance(value,str) or not value or '\x00' in value:raise ValueError('SQL identifier required')
    return '"'+value.replace('"','""')+'"'


def copy_sql(table):
    schema,name=table['schema'],table['name'];columns=table['columns'];pk=table['primaryKey']
    if not columns or len(set(columns))!=len(columns) or len(set(pk))!=len(pk) or not set(pk).issubset(columns):
        raise ValueError('Complete unique column/key inventory required')
    fields=[]
    for name in columns:
        col='t.'+identifier(name)
        fields.append("CASE WHEN "+col+" IS NULL THEN 'N;' ELSE 'V'||octet_length(convert_to("+col+"::text,'UTF8'))::text||':'||"+col+"::text||';' END")
    order=','.join('t.'+identifier(col)+('' if pk else '::text COLLATE "C"')+' NULLS FIRST' for col in (pk or columns))
    relation=identifier(schema)+'.'+identifier(table['name'])
    return 'COPY (SELECT '+"||".join(fields)+' FROM '+relation+' t ORDER BY '+order+') TO STDOUT WITH (FORMAT binary);'


class BinaryCounter:
    """Count text records without retaining a record or exposing any row bytes."""
    def __init__(self):
        self.buffer=b'';self.header=False;self.remaining=0;self.rows=0;self.ended=False

    def update(self,data):
        if self.ended and data:raise ValueError('Bytes after COPY trailer')
        self.buffer+=data
        if not self.header:
            if len(self.buffer)<19:return
            if self.buffer[:11]!=b'PGCOPY\n\xff\r\n\x00' or self.buffer[11:19]!=b'\x00'*8:
                raise ValueError('Unexpected PostgreSQL binary COPY header')
            self.buffer=self.buffer[19:];self.header=True
        while self.buffer:
            if self.remaining:
                size=min(self.remaining,len(self.buffer));self.buffer=self.buffer[size:];self.remaining-=size
                if self.remaining:return
            if len(self.buffer)<2:return
            fields=struct.unpack('!h',self.buffer[:2])[0]
            if fields==-1:
                self.buffer=self.buffer[2:];self.ended=True
                if self.buffer:raise ValueError('Trailing COPY bytes')
                return
            if fields!=1:raise ValueError('One framed text field per row required')
            if len(self.buffer)<6:return
            length=struct.unpack('!i',self.buffer[2:6])[0]
            if length<0:raise ValueError('Framed row cannot be SQL NULL')
            self.buffer=self.buffer[6:];self.remaining=length;self.rows+=1

    def finish(self):
        if not self.header or not self.ended or self.remaining or self.buffer:raise ValueError('Incomplete COPY stream')
        return self.rows


def fingerprint(args,environment,sql,timeout=180,maximum=1_000_000_000):
    # No shell or connection strings. Private libpq environment remains in RAM.
    process=subprocess.Popen(args,env=environment,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    try:
        process.stdin.write(sql.encode());process.stdin.close()
        deadline=time.monotonic()+timeout;digest=hashlib.md5();counter=BinaryCounter();size=0
        while True:
            remaining=deadline-time.monotonic()
            if remaining<=0 or not select.select([process.stdout],[],[],remaining)[0]:raise RuntimeError('Fingerprint stream timeout; raw output withheld')
            chunk=os.read(process.stdout.fileno(),65536)
            if not chunk:break
            size+=len(chunk)
            if size>maximum:raise RuntimeError('Fingerprint stream size bound; no truncation or PASS')
            digest.update(chunk);counter.update(chunk)
        error=process.stderr.read(32768)
        if process.wait(timeout=max(1,deadline-time.monotonic())):
            codes=sorted(set(re.findall(rb'(?:ERROR|FATAL):\s+([A-Z0-9]{5})',error)))
            raise RuntimeError('Fingerprint SQL failed; SQLSTATE='+','.join(x.decode() for x in codes)+'; rows/errors withheld')
        return {'algorithm':ALGORITHM,'rows':str(counter.finish()),'md5':digest.hexdigest(),'serializedBytes':str(size)}
    finally:
        if process.poll() is None:process.kill();process.wait()
        for stream in (process.stdin,process.stdout,process.stderr):
            if stream and not stream.closed:stream.close()
