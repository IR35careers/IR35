"""Compiler-test bootstrap only. No private state or external side effects."""
from contextlib import contextmanager,ExitStack
import builtins
import io
import os
from pathlib import Path
import socket
import subprocess
from unittest.mock import patch
import cloud_schema as schema

PUBLIC_BOOTSTRAP='''# PUBLIC_NON_SECRET_COMPILER_FIXTURE
import json,types,sys,subprocess,re
runtime={}
'''


class OfflineBootstrapViolation(AssertionError):pass


def denied(*args,**kwargs):
    raise OfflineBootstrapViolation('Compiler fixture attempted private state, subprocess or network access')


@contextmanager
def public_bootstrap():
    """Only the test bootstrap is substituted; every downstream source loads.

    Runtime builders/custody checks stay unmodified. Compile/import-order tests
    may READ repository source, never private paths, sockets or subprocesses.
    """
    root=schema.REPO.resolve()
    native_open=builtins.open;native_io=io.open;native_os=os.open

    def allowed(path):
        if not isinstance(path,(str,bytes,os.PathLike)):denied()
        candidate=Path(os.fsdecode(path)).resolve()
        if not candidate.is_relative_to(root) or any(part=='.ir35' or part=='.oci' or part.startswith('.env') for part in candidate.parts):denied()

    def read_open(native,path,mode='r',*args,**kwargs):
        allowed(path)
        if not isinstance(mode,str) or any(flag in mode for flag in 'wax+'):denied()
        return native(path,mode,*args,**kwargs)

    def fd_open(path,flags,*args,**kwargs):
        allowed(path)
        if flags&(os.O_WRONLY|os.O_RDWR|os.O_CREAT|os.O_TRUNC|os.O_APPEND):denied()
        return native_os(path,flags,*args,**kwargs)

    def bootstrap(*,rehearsal=False):
        if type(rehearsal)is not bool:raise AssertionError('Explicit fixture rehearsal boolean required')
        return PUBLIC_BOOTSTRAP

    with ExitStack() as stack:
        replacement=stack.enter_context(patch.object(schema,'guest_bundle',side_effect=bootstrap))
        stack.enter_context(patch.object(schema,'private_file',side_effect=denied))
        stack.enter_context(patch.object(builtins,'open',side_effect=lambda path,mode='r',*a,**k:read_open(native_open,path,mode,*a,**k)))
        stack.enter_context(patch.object(io,'open',side_effect=lambda path,mode='r',*a,**k:read_open(native_io,path,mode,*a,**k)))
        stack.enter_context(patch.object(os,'open',side_effect=fd_open))
        for name in ('socket','create_connection','getaddrinfo'):stack.enter_context(patch.object(socket,name,side_effect=denied))
        for name in ('Popen','run','check_output','check_call','call'):stack.enter_context(patch.object(subprocess,name,side_effect=denied))
        yield replacement
