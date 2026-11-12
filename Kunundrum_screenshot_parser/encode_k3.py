#!/usr/bin/env python3
"""Pure-Python K3 board serializer; no Node.js needed.

Matches the v3.0.1 Replay Lab binaryBoard format. For board files with saved
solutions, this encodes the move stream but does NOT simulate/validate it;
use the app to check successful completion before treating it as verified.
"""
import base64
import json
import math
import re
import sys
from pathlib import Path

COLORS='RGBY*'
DIRS='udlr'

def varuint(n):
    n=int(n)
    if n<0:raise ValueError('negative unsigned integer')
    out=[]
    while True:
        b=n&127;n>>=7
        out.append(b|(128 if n else 0))
        if not n:return bytes(out)

def packbits(values,width):
    out=bytearray();b=0;used=0
    for v in values:
        if v<0 or v>=1<<width:raise ValueError('invalid packed value')
        for shift in range(width-1,-1,-1):
            b=(b<<1)|((v>>shift)&1);used+=1
            if used==8:out.append(b);used=b=0
    if used:out.append(b<<(8-used))
    return bytes(out)

def normalized(board):
    data=dict(board)
    order=lambda a:(a['y'],a['x'])
    for k in ('walls','goals','arrows','gates','switches','hexes'):
        data[k]=sorted(data.get(k,[]),key=order)
    data['balls']=[v for c in 'RGBY' for v in sorted((v for v in data.get('balls',[]) if v['color']==c),key=order)]
    groups={}
    for v in data['balls']:groups[v['color']]=groups.get(v['color'],0)+1
    counters={}
    for v in data['balls']:
        c=v['color'];counters[c]=counters.get(c,0)+1
        v['id']=(c+str(counters[c])) if groups[c]>1 else c
    data['teleports']=sorted(data.get('teleports',[]),key=lambda a:a['id'])
    for v in data['teleports']:v['ends']=sorted(v['ends'],key=order)
    return data

def compact_solution(board,solution):
    solution=re.sub(r'\s+','',solution)
    groups=solution.split(',')
    stream=[]; choices=[]
    for group in groups:
        match=re.match(r'([RGBY](?:[1-9]\d*)?|[1-9]\d*)',group)
        if not match:raise ValueError('Invalid move group '+group)
        name=match.group(1)
        if name.isdecimal():
            bi=int(name)-1
        else:
            matches=[i for i,b in enumerate(board['balls']) if b['id']==name]
            if not matches and len(name)==1:
                matches=[i for i,b in enumerate(board['balls']) if b['color']==name]
            if len(matches)!=1:raise ValueError('Ambiguous ball '+name)
            bi=matches[0]
        if bi<0 or bi>=len(board['balls']):raise ValueError('Unknown ball')
        remainder=group[len(name):]
        if not remainder:raise ValueError('Empty move group')
        while remainder:
            if remainder[0] not in DIRS:raise ValueError('Invalid direction')
            direction=DIRS.index(remainder[0]);remainder=remainder[1:]
            picked=[]
            while remainder.startswith('('):
                m=re.match(r'\((?:->|→)([udlr])\)',remainder)
                if not m:raise ValueError('Invalid rotating choice')
                picked.append(DIRS.index(m.group(1)));remainder=remainder[len(m.group()):]
            stream.append(bi*4+direction);choices.append(picked)
    if not 0<len(stream)<=10000:raise ValueError('Invalid move count')
    mode=int(any(choices))
    out=bytearray(varuint(len(stream)))
    out.append(mode)
    out.extend(packbits(stream,(len(board['balls'])*4-1).bit_length()))
    if mode:
        for item in choices:out.extend(varuint(len(item)))
        out.extend(packbits([x for item in choices for x in item],2))
    return bytes(out)

def encode(board):
    board=normalized(board)
    width=board['width'];height=board['height']
    if not 1<=width<=32 or not 1<=height<=32:raise ValueError('Invalid grid')
    out=bytearray((0xB3,width,height));dictionary={}
    def ui(n):out.extend(varuint(n))
    def string(s):
        if s in dictionary:ui(2*dictionary[s]+1)
        else:
            enc=s.encode('utf8');ui(2*len(enc));out.extend(enc);dictionary[s]=len(dictionary)
    def at(p):ui((p['y']-1)*width+p['x']-1)
    def items(seq,fn):
        ui(len(seq))
        for v in seq:fn(v)
    def color(c):ui(COLORS.index(c))
    flags=int('description' in board)+2*int('solution' in board)
    ui(flags);string(board.get('id','custom'));string(board.get('title','Custom board'))
    if flags&1:string(board['description'])
    if flags&2:
        payload=compact_solution(board,board['solution'])
        ui(len(payload));out.extend(payload)
    items(board['walls'],at)
    def ball(p):at(p);color(p['color'])
    items(board['balls'],ball);items(board['goals'],ball)
    def arrow(p):at(p);ui(DIRS.index(p['direction'])*2+int(p.get('rotating',False)))
    items(board['arrows'],arrow)
    def gate(p):at(p);string(p['id']);string(p.get('group',p['id']));ui(int(p.get('active',True)))
    items(board['gates'],gate)
    def sw(p):
        at(p);string(p['id']);ui(int(p.get('on',False)))
        items(sorted(p.get('wallGroups',[])),string)
        items(sorted(p.get('teleportIds',[])),string)
    items(board['switches'],sw)
    def tp(p):
        string(p['id']);color(p['color']);ui(int(p.get('active',True)));at(p['ends'][0]);at(p['ends'][1])
    items(board['teleports'],tp)
    def he(p):at(p);string(p['id']);value=p['value'];ui(-2*value-1 if value<0 else 2*value)
    items(board['hexes'],he)
    return 'K3.'+base64.urlsafe_b64encode(out).decode('ascii').rstrip('=')

if __name__=='__main__':
    if len(sys.argv)!=2:raise SystemExit('Usage: python3 encode_k3.py board.json')
    print(encode(json.loads(Path(sys.argv[1]).read_text())))
