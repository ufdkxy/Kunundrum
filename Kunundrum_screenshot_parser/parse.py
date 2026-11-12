#!/usr/bin/env python3
"""Offline screenshot -> editable Kunundrum board JSON, visual QA, optional K3.

Requires numpy and opencv-python. See README.md. Screen coordinates are
converted to bottom-left-origin, one-based game coordinates.
"""
from __future__ import annotations
import argparse
import json
import math
import re
import subprocess
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

COLORS = ('R','G','B','Y')
COLOR_LABELS = dict(R=(70,80,255),G=(75,255,80),B=(255,225,75),Y=(70,240,255))

@dataclass
class Geometry:
    left: float
    top: float
    cell: float
    width: int
    height: int
    score: float


def frame_component(img):
    """Find the biggest *connected cyan border*, rejecting interface chrome."""
    b,g,r=cv2.split(img)
    mask=np.uint8((b>88)&(g>88)&(r<155)&(b.astype(np.int16)>r.astype(np.int16)+30))*255
    count, lab, stats, cent = cv2.connectedComponentsWithStats(mask,8)
    h,w=img.shape[:2]
    options=[]
    for x,y,ww,hh,area in stats[1:]:
        if ww < .17*w or hh < .17*h or ww/hh < .9: continue
        if y < .05*h or y > .65*h: continue
        options.append((area,x,y,ww,hh))
    if not options: raise ValueError('Could not find the cyan Kunundrum board outline. Use --grid to specify its geometry.')
    _,x,y,ww,hh=max(options)
    return (int(x),int(y),int(ww),int(hh))


def period_autocorrelation(img,rect):
    x,y,w,h=rect
    pad=max(6,int(min(w,h)*.02))
    roi=img[y+pad:y+h-pad,x+pad:x+w-pad,0].astype(np.float32)
    scores=[]
    for proj in (np.abs(np.diff(roi,axis=1)).mean(axis=0),np.abs(np.diff(roi,axis=0)).mean(axis=1)):
        proj=proj-proj.mean()
        a=np.correlate(proj,proj,mode='full')[len(proj)-1:]
        a=a/max(a[0],1e-9)
        scores.append(a)
    # Prefer cell sizes 25-150px. A half-size harmonic can be prominent in the
    # actual grid, so score evidence from both axes together and choose largest
    # strong peak among harmonics, then validate against the outer dimensions.
    possibles=[]
    for ncol in range(3,33):
        cell=w/ncol
        if cell<22 or cell>180: continue
        nrow=round(h/cell)
        if nrow<2 or nrow>32:continue
        error=abs(h/nrow-cell)/cell
        if error>.055: continue
        d=round((w/ncol+h/nrow)/2)
        if d<15:continue
        ax,ay=scores
        if d>=len(ax) or d>=len(ay):continue
        signal=float(ax[d]+ay[d])
        possibles.append((signal-2*error,cell,ncol,nrow,error))
    if not possibles: raise ValueError('Could not infer a square cell grid; use --grid.')
    best=max(possibles,key=lambda t:t[0])
    # Search for a larger fundamental if autocorrelation gives a half-cell alias.
    return best


def detect_geometry(img,grid=None):
    if grid:
        vals=[float(v.strip()) for v in grid.split(',')]
        if len(vals)!=5:raise ValueError('--grid is LEFT,TOP,CELL,COLS,ROWS')
        l,t,c,w,h=vals
        return Geometry(l,t,c,int(w),int(h),1.)
    rect=frame_component(img)
    score0,approx,w,h,_=period_autocorrelation(img,rect)
    x,y,ww,hh=rect
    # Use the actual grid's repeated pixel lines, not the glowing border width.
    # The outer cyan glow can be 10-20px thick after scaling; dividing the
    # component bounding box by column count would introduce accumulated drift.
    pad=max(5,round(min(ww,hh)*.02))
    b=img[:,:,0].astype(np.float32)
    roi=b[y+pad:y+hh-pad,x+pad:x+ww-pad]
    acs=[]
    for proj in (np.abs(np.diff(roi,axis=1)).mean(0),np.abs(np.diff(roi,axis=0)).mean(1)):
        p=proj-proj.mean()
        ac=np.correlate(p,p,mode='full')[len(p)-1:]
        ac/=max(ac[0],1e-8)
        acs.append(ac)
    cand=range(max(22,round(approx*.89)),min(round(approx*1.11)+1,len(acs[0]),len(acs[1])))
    period=max(cand,key=lambda v:float(acs[0][v]+acs[1][v]))
    # Candidate origin is located by aggregating derivatives along expected
    # vertical/horizontal grid lines; each is averaged over the board interior.
    # The regular lines are present even where the board has stepped edges.
    reg=img[max(0,y+pad):min(img.shape[0],y+hh-pad),:,0].astype(np.float32)
    gx=np.abs(np.diff(reg,axis=1)).mean(axis=0)
    reg=img[:,max(0,x+pad):min(img.shape[1],x+ww-pad),0].astype(np.float32)
    gy=np.abs(np.diff(reg,axis=0)).mean(axis=1)
    def best_origin(proj,start,count):
        best=(-1e20,0)
        for offset in np.arange(start-18,start+22,.5):
            inds=[round(offset+i*period) for i in range(1,count)]
            if min(inds)<1 or max(inds)>=len(proj)-2:continue
            signal=sum(max(proj[k-1:k+2]) for k in inds)
            # weak anchor prior prevents selecting a shifted harmonic
            signal-=.06*abs(offset-start)
            if signal>best[0]:best=(signal,offset)
        return best[1]
    left=best_origin(gx,x,w)
    top=best_origin(gy,y,h)
    return Geometry(left,top,float(period),w,h,float(acs[0][period]+acs[1][period]))

def crop_cell(img,geom,col,row,size=96):
    # row is 0-indexed from top
    x=geom.left+col*geom.cell
    y=geom.top+row*geom.cell
    p=np.float32([[x,y],[x+geom.cell,y],[x,y+geom.cell]])
    q=np.float32([[0,0],[size,0],[0,size]])
    mat=cv2.getAffineTransform(p,q)
    return cv2.warpAffine(img,mat,(size,size),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)


def patch_features(patch):
    p=cv2.resize(patch,(96,96),interpolation=cv2.INTER_AREA)
    b,g,r=cv2.split(p)
    yy,xx=np.ogrid[:96,:96]
    radial=np.sqrt((xx-47.5)**2+(yy-47.5)**2)
    core=(radial<13)
    ann=(radial>26)&(radial<39)
    mids=(radial>15)&(radial<31)
    box=b[26:70,26:70]
    # Exterior is nearly pure black, unlike the dark blue checker/grid floor.
    presence=float((box>5).mean())
    hsv=cv2.cvtColor(p,cv2.COLOR_BGR2HSV)
    bright=np.max(p,axis=2)>125
    bright_count=int((bright&(radial<40)).sum())
    core_bright=float(bright[core].mean())
    ann_bright=float(bright[ann].mean())
    mid_bright=float(bright[mids].mean())
    # Sprite color is judged using reasonably saturated, luminous pixels. White
    # ball centers are excluded; hue comes from their colored outer fringes.
    sat=(hsv[:,:,1]>90)&(hsv[:,:,2]>75)&(radial<42)
    hues=hsv[:,:,0][sat]
    weights=hsv[:,:,2][sat].astype(float)
    hue_groups={
      'R': ((hues<12)|(hues>169)),
      'Y': ((hues>=12)&(hues<39)),
      'G': ((hues>=39)&(hues<85)),
      'B': ((hues>=85)&(hues<=169)),
    }
    counts={k:float(weights[mask].sum()) for k,mask in hue_groups.items()}
    c=max(counts,key=counts.get)
    color_strength=counts[c]/max(sum(counts.values()),1)
    return dict(presence=presence,bright_count=bright_count,core_bright=core_bright,
                ann_bright=ann_bright,mid_bright=mid_bright,color=c,
                color_strength=float(color_strength),color_count=float(sum(counts.values())))


def image_signature(patch):
    # BGR similarity, including the distinctive colored geometry of the sprite.
    p=cv2.resize(patch,(48,48),interpolation=cv2.INTER_AREA).astype(np.float32)
    return p


def load_templates(folder):
    if not folder or not Path(folder).exists():return []
    found=[]
    for path in sorted(Path(folder).glob('*.png')):
        name=path.stem.split('__')[0]
        if not (name in ('floor','wall','outside','switch') or
                name.startswith(('ball_','goal_','teleport_','gate_','arrow_','hex_'))):continue
        img=cv2.imread(str(path))
        if img is not None:found.append((name,image_signature(img)))
    return found


# Sprite templates for the four fixed arrow directions, in normalized cell
# coordinates. Only used when an asymmetric luminous blue arrow is detected.
ARROW_TEMPLATES=None

def direction_from_sprite(patch):
    global ARROW_TEMPLATES
    if ARROW_TEMPLATES is None:
        directory=Path(__file__).resolve().parent/'arrow_templates'
        ARROW_TEMPLATES=[]
        for path in sorted(directory.glob('*.png')):
            im=cv2.imread(str(path))
            if im is not None:ARROW_TEMPLATES.append((path.stem[0],image_signature(im)))
    if not ARROW_TEMPLATES:return None,0.
    sig=image_signature(patch)
    dist=sorted((float(np.mean((sig-ref)**2)),direction) for direction,ref in ARROW_TEMPLATES)
    best,direction=dist[0]
    competing=min((v for v,d in dist if d!=direction),default=1e9)
    # If no matching template exists, flag as unknown rather than guessing.
    if best>3800:return None,0.
    return direction,(.93 if best<1300 else .76 if best<2300 else .62)


# Animation-robust arrow matching: compare shapes instead of absolute brightness.
# Each template is a 36x36 normalized blue-channel silhouette. The game animates
# arrow brightness, but the positions of its chevrons remain detectable even in
# a dim frame. The templates are bundled; no original screenshots are needed.
ARROW_SHAPES = None

def blue_arrow_signature(patch):
    p=cv2.resize(patch,(96,96),interpolation=cv2.INTER_AREA)
    b=p[:,:,0].astype(np.float32)
    v=np.maximum(0,b-30)
    v=cv2.GaussianBlur(v,(3,3),1)
    v=cv2.resize(v[12:84,12:84],(36,36),interpolation=cv2.INTER_AREA)
    v-=v.mean()
    return v/(np.linalg.norm(v)+1.e-8)

def arrow_shape_match(patch):
    global ARROW_SHAPES
    if ARROW_SHAPES is None:
        ARROW_SHAPES={}
        directory=Path(__file__).resolve().parent/'arrow_shapes'
        for f in directory.glob('*.png'):
            d=f.stem[0]
            if d not in 'udlr':continue
            t=cv2.imread(str(f),cv2.IMREAD_GRAYSCALE)
            if t is None:continue
            t=t.astype(np.float32)/255.
            t-=t.mean()
            ARROW_SHAPES[f.stem]=(d,t/(np.linalg.norm(t)+1.e-8))
    if not ARROW_SHAPES:return None,0.
    b=patch[:,:,0]
    core=b[14:82,14:82]
    # An arrow retains blue signal even during the darkest animation phase.
    # Floor texture, by contrast, stays below 40 on almost all interior pixels.
    if np.count_nonzero(core>48)<600:return None,0.
    f=patch_features(patch)
    if f['core_bright']>.50 or f['ann_bright']>.33 or f['color_strength']<.72 or f['color']!='B':
        return None,0.
    sig=blue_arrow_signature(patch)
    by_direction={d:max((float(np.sum(sig*ref)) for direction,ref in ARROW_SHAPES.values() if direction==d),default=-1.) for d in 'udlr'}
    scores=sorted(((v,d) for d,v in by_direction.items()),reverse=True)
    if not scores or scores[0][0]<.84:return None,0.
    if len(scores)>1 and scores[0][0]-scores[1][0]<.06:return None,0.
    return scores[0][1], min(.99,scores[0][0])

def overlay_colors(patch):
    """Detect a ball sitting on a differently colored goal ring."""
    p=cv2.resize(patch,(96,96)); hsv=cv2.cvtColor(p,cv2.COLOR_BGR2HSV)
    yy,xx=np.ogrid[:96,:96]
    radial=np.sqrt((xx-47.5)**2+(yy-47.5)**2)
    out=[]
    for region in (radial<16,(radial>29)&(radial<39)):
        mask=region&(hsv[:,:,1]>85)&(hsv[:,:,2]>105)
        hues=hsv[:,:,0][mask];value=hsv[:,:,2][mask]
        if len(hues)<75:return None
        bins={'R':float(value[((hues<20)|(hues>169))].sum()),
              'Y':float(value[(hues>=20)&(hues<39)].sum()),
              'G':float(value[(hues>=39)&(hues<85)].sum()),
              'B':float(value[(hues>=85)&(hues<=169)].sum())}
        col=max(bins,key=bins.get)
        if bins[col]<.54*sum(bins.values()):return None
        out.append(col)
    return out if out[0]!=out[1] else None

def classify(patch,templates):
    f=patch_features(patch)
    shape_dir,shape_conf=arrow_shape_match(patch)
    if shape_dir is not None:
        return 'arrow_'+shape_dir,shape_conf,f
    # Mechanic sprites are visually very different from colored balls/goals.
    # Switches are glossy red discs; gates are yellow-hatched metal; plain
    # metal tiles are permanent walls. Evaluate these before colored objects.
    # Unlike a ball, a directional chevron is strongly asymmetric under a
    # half turn. This test is scale-invariant and avoids falsely treating all
    # arrows as blue balls. A bright, nearly circular blue ball is symmetric.
    gray=cv2.cvtColor(patch,cv2.COLOR_BGR2GRAY)
    gray=cv2.GaussianBlur(gray,(5,5),1)[12:84,12:84]
    asym=float(np.mean(np.abs(gray.astype(np.float32)-np.rot90(gray,2).astype(np.float32))))
    coremask=np.hypot(*np.ogrid[-47.5:48.5,-47.5:48.5])<13
    grayfull=cv2.cvtColor(patch,cv2.COLOR_BGR2GRAY)
    whitecore=float(((patch.min(axis=2)>165)&(grayfull>200))[coremask].mean())
    if (f['color']=='B' and f['color_strength']>.85 and f['core_bright']>.69
        and f['ann_bright']<.23 and 900<f['bright_count']<2400 and asym>24.3 and not (whitecore>.46 and float(grayfull[coremask].mean())>202)):
        direction,confidence=direction_from_sprite(patch)
        return ('arrow_'+direction if direction else 'unknown'),confidence,f
    overlap=overlay_colors(patch) if f['bright_count']>2400 and f['core_bright']>.85 else None
    if overlap:
        return 'ball_'+overlap[0]+'+goal_'+overlap[1],.91,f
    if f['core_bright']<.02 and 120<f['bright_count']<900 and f['ann_bright']<.26 and f['mid_bright']<.12:
        typ='outside';conf=.94
    elif f['presence']<.18:
        typ='outside'; conf=.99
    elif f['bright_count']>2700 and f['color']=='R' and f['mid_bright']>.78 and f['ann_bright']>.39:
        typ='switch'; conf=.98
    elif f['color']=='Y' and f['color_strength']>.86 and .32<f['ann_bright']<.60 and f['core_bright']<.50 and f['mid_bright']>.55:
        typ='gate_detected'; conf=.95
    elif f['bright_count']>450 and f['color_strength']<.20 and .10<f['ann_bright']<.40:
        typ='wall'; conf=.96
    elif 1050<f['bright_count']<2500 and .54<f['core_bright']<.88 and f['ann_bright']<.22 and f['mid_bright']<.62:
        typ='hex_pending'; conf=.88
    elif f['bright_count']<95:
        typ='floor'; conf=.96
    else:
        c=f['color']
        if f['ann_bright']>.54 and f['bright_count']>550:
            typ=f'goal_{c}';conf=min(.98,.68+.3*(f['ann_bright']-.54)/.4)
        elif f['core_bright']>.88 and f['bright_count']>1300:
            typ=f'ball_{c}';conf=.90
        elif f['core_bright']>.38 and f['bright_count']<1450 and f['ann_bright']<.38:
            typ=f'teleport_{c}';conf=.78
        else:
            typ='unknown';conf=.0
    # Compare against calibrated sprite examples. The optional templates do not
    # silently supersede very strong floor/outside predictions.
    if templates and typ not in ('outside','floor'):
        signature=image_signature(patch)
        scored=sorted((float(np.mean((signature-im)**2)),kind) for kind,im in templates)
        if scored:
            best,kind=scored[0]
            runner=scored[1][0] if len(scored)>1 else float('inf')
            # A stringent pixel-level match is reliable for same-artwork crops;
            # otherwise leave it for explicit human review.
            if best<950 and (runner>best*1.25 or best<180):
                typ=kind;conf=max(conf,min(.99,.7+.28*(1-min(best/950,1))))
    return typ,conf,f


def robust_geometry(img,grid=None):
    """Use *all* cyan outline components, including disconnected islands.

    The cyan neon is disconnected on some levels; largest-component selection
    loses entire portions of the game. Its extreme bounding rectangle remains
    reliable on a full-frame phone screenshot.  Check the candidate geometry
    against repeated grid seams, not against sprites or textured metal.
    """
    if grid: return detect_geometry(img,grid)
    b,g,r=cv2.split(img)
    h,w=b.shape
    cyan=(b>88)&(g>88)&(r<155)&(b.astype(np.int16)>r.astype(np.int16)+30)
    cyan[:int(h*.125)]=False
    cyan[int(h*.94):]=False
    # Reject isolated highlights: at least a few pixels of horizontal/vertical
    # continuity. Other parts of the screenshot are black at these heights.
    yy,xx=np.where(cyan)
    if len(xx)<200:raise ValueError('Could not find cyan board outline')
    x0,x1=int(xx.min()),int(xx.max())
    y0,y1=int(yy.min()),int(yy.max())
    spanx=x1-x0+1;spany=y1-y0+1
    options=[]
    for cell in range(42,111):
        cols=round((spanx-23)/cell)
        rows=round((spany-17)/cell)
        if cols<2 or cols>32 or rows<2 or rows>32:continue
        mx=spanx-cols*cell;my=spany-rows*cell
        if not (6<=mx<=40 and 2<=my<=40):continue
        # True game cell sizes tend to be exact integers at source resolution.
        # Grid seam regularity resolves ambiguities on unusually large boards.
        left=x0+12
        top=y0+(5 if cell<85 else 11)
        g0=Geometry(left,top,float(cell),cols,rows,0.)
        # Evaluate seam positions on the blue channel, averaging over only the
        # interior. Ignore neon from the outer outline.
        xb=img[:,:,0].astype(np.float32)
        dx=np.abs(np.diff(xb,axis=1));dy=np.abs(np.diff(xb,axis=0))
        seamx=[];seamy=[]
        for j in range(1,cols):
            xx0=round(left+j*cell)
            if xx0<1 or xx0>=w-2:continue
            seamx.append(float(np.mean(dx[max(0,y0+15):min(h,y1-15),xx0-1:xx0+2])))
        for j in range(1,rows):
            yy0=round(top+j*cell)
            if yy0<1 or yy0>=h-2:continue
            seamy.append(float(np.mean(dy[yy0-1:yy0+2,max(0,x0+15):min(w,x1-15)])))
        seam=(np.mean(seamx) if seamx else 0)+(np.mean(seamy) if seamy else 0)
        # The outer border thickness is about 20px across; y thickness varies
        # when a narrow protrusion touches the top/bottom of the screenshot.
        fit=abs(mx-23)*.15+min(abs(my-10),abs(my-23))*.12
        score=seam*.12-fit-.008*(cols+rows)-.45*abs(cell-round(cell/10)*10)
        options.append((score,g0))
    if not options:raise ValueError('Could not establish a grid from the full cyan outline; use --grid')
    score,geom=max(options,key=lambda t:t[0]);geom.score=score
    return geom


def parse_label(label):
    label=label.strip().replace(':','_')
    if label in ('empty','floor','outside','wall','switch','unknown','hex_pending','gate_detected'):
        return label
    if '+' in label:
        return '+'.join(parse_label(part) for part in label.split('+'))
    parts=label.split('_')
    if parts[0] in ('ball','goal','teleport') and len(parts)==2 and parts[1] in COLORS:return label
    if parts[0]=='switch' and len(parts)==2:return label
    if parts[0]=='arrow' and len(parts)==2 and parts[1] in ('u','d','l','r','rotating'):return label
    if parts[0]=='gate' and len(parts)>=2:return label
    if parts[0]=='hex' and len(parts)==2:
        int(parts[1]);return label
    raise ValueError(f'Invalid cell label {label!r}')


def assemble_board(labels,geom,level,overrides):
    walls=[]; balls=[]; goals=[]; arrows=[]; gates=[]; switches=[]; hexes=[]; telecells=defaultdict(list)
    unresolved=[]
    for row in range(geom.height):
        for col in range(geom.width):
            kind=labels[row][col]
            x,y=col+1,geom.height-row
            pos={'x':x,'y':y}
            if '+' in kind:
                for part in kind.split('+'):
                    if part.startswith('ball_'):balls.append(dict(**pos,color=part[5:]))
                    elif part.startswith('goal_'):goals.append(dict(**pos,color=part[5:]))
            elif kind in ('outside','wall'):walls.append(pos)
            elif kind in ('floor','empty'):pass
            elif kind.startswith('ball_'):balls.append(dict(**pos,color=kind[5:]))
            elif kind.startswith('goal_'):goals.append(dict(**pos,color=kind[5:]))
            elif kind.startswith('teleport_'):telecells[kind[9:]].append(pos)
            elif kind.startswith('arrow_'):
                d=kind[6:]
                arrows.append(dict(**pos,direction='u' if d=='rotating' else d,**({'rotating':True} if d=='rotating' else {})))
            elif kind == 'hex_pending':
                unresolved.append(f'Hexagon at ({x},{y}) needs its signed value')
            elif kind.startswith('hex_'):hexes.append(dict(**pos,id=f'H{len(hexes)+1}',value=int(kind[4:])))
            elif kind == 'gate_detected':
                gid=f'W{len(gates)+1}'
                gates.append(dict(**pos,id=gid,group=gid,active=True))
            elif kind.startswith('gate_'):
                bits=kind.split('_')
                gate_id=bits[1]
                active=not (len(bits)>2 and bits[2] in ('off','inactive','false'))
                gates.append(dict(**pos,id=gate_id,group=gate_id,active=active))
            elif kind.startswith('switch'):
                sid=kind.split('_',1)[1] if '_' in kind else f'S{len(switches)+1}'
                switches.append(dict(**pos,id=sid,wallGroups=[],teleportIds=[]))
                unresolved.append(f'Switch at ({x},{y}) has unknown mapping')
            else:unresolved.append(f'Unrecognized object at ({x},{y})')
    teleports=[]
    pair_config=overrides.get('teleports',[])
    if pair_config:
        for i,item in enumerate(pair_config):
            teleports.append(dict(id=item.get('id',f'T{i+1}'),color=item['color'],ends=item['ends'],active=item.get('active',True)))
    else:
        for color,ends in telecells.items():
            if len(ends)==2:teleports.append(dict(id=f'T{color}',color=color,ends=ends,active=True))
            elif len(ends):unresolved.append(f'{len(ends)} {color} teleport endpoints: explicit pairing required')
    switch_info=overrides.get('switches',{})
    for s in switches:
        if s['id'] in switch_info:
            spec=switch_info[s['id']]
            s['wallGroups']=list(spec.get('wallGroups',[]))
            s['teleportIds']=list(spec.get('teleportIds',[]))
    if switch_info:
        mapped_positions={(s['x'],s['y']) for s in switches if s['id'] in switch_info}
        for mx,my in mapped_positions:
            unresolved=[w for w in unresolved if w != f'Switch at ({mx},{my}) has unknown mapping']
    # A board with exactly one switch has an unambiguous mapping if the only
    # switchable objects are wall gates: toggling the switch toggles every gate.
    # In more complex boards, preserve an explicit mapping warning.
    if len(switches)==1 and gates and not teleports:
        switches[0]['wallGroups']=[g['group'] for g in gates]
        sw=switches[0]
        unresolved=[w for w in unresolved if w != f'Switch at ({sw["x"]},{sw["y"]}) has unknown mapping']
    gate_groups=overrides.get('gateGroups',{})
    for gate in gates:
        gate['group']=gate_groups.get(gate['id'],gate['group'])
    # Matching balls to goals can detect many otherwise silent classification errors.
    bc=Counter(b['color'] for b in balls)
    gc=Counter(g['color'] for g in goals)
    for color,n in bc.items():
        if gc[color]<n:unresolved.append(f'{color}: {n} balls but only {gc[color]} goals')
    if not balls:unresolved.append('No balls detected')
    board=dict(version=1,id=level,title=f'Level {level}',width=geom.width,height=geom.height,
               walls=walls,balls=balls,goals=goals,arrows=arrows,gates=gates,
               switches=switches,teleports=teleports,hexes=hexes)
    if 'solution' in overrides:board['solution']=overrides['solution']
    return board,unresolved


def review_image(original,geom,labels,confidences,output):
    canvas=original.copy()
    palette={'ball':(120,255,110),'goal':(255,255,80),'teleport':(255,170,80),
             'gate':(100,170,255),'switch':(255,100,255),'arrow':(170,220,255),
             'hex':(255,175,175),'unknown':(0,0,255)}
    for row in range(geom.height):
        for col in range(geom.width):
            label=labels[row][col]
            if label in ('outside','floor','empty'):continue
            px=round(geom.left+col*geom.cell)
            py=round(geom.top+row*geom.cell)
            d=round(geom.cell)
            color=palette.get(label.split('_')[0],(80,80,255))
            if confidences[row][col]<.7:color=(0,0,255)
            cv2.rectangle(canvas,(px+3,py+3),(px+d-3,py+d-3),color,2)
            fsize=max(.34,min(.65,geom.cell/160))
            cv2.putText(canvas,label.replace('teleport','tp').replace('unknown','?'),(px+5,py+d-8),
                        cv2.FONT_HERSHEY_SIMPLEX,fsize,color,2,cv2.LINE_AA)
    cv2.imwrite(str(output),canvas)


def parse_one(path,out,grid,templates,overrides,write_codes):
    im=cv2.imread(str(path))
    if im is None:raise ValueError(f'Could not read image: {path}')
    geometry=robust_geometry(im,grid)
    labels=[];confidence=[];warnings=[];stats=[]
    overrides_cells=overrides.get('cells',{})
    for row in range(geometry.height):
        labs=[];confs=[]
        for col in range(geometry.width):
            patch=crop_cell(im,geometry,col,row)
            kind,conf,features=classify(patch,templates)
            key=f'{col+1},{geometry.height-row}'
            if key in overrides_cells:
                kind=parse_label(str(overrides_cells[key]));conf=1.
            labs.append(kind);confs.append(conf)
            if kind=='unknown' or (conf<.7 and kind not in ('outside','floor')):
                warnings.append(f'Cell ({key}) classified {kind}, confidence {conf:.2f}')
            stats.append({'x':col+1,'y':geometry.height-row,'kind':kind,'confidence':round(conf,3),
                          'measurements':{k:round(v,3) if isinstance(v,float) else v for k,v in features.items()}})
        labels.append(labs);confidence.append(confs)
    level_match=re.search(r'(?<![0-9])([0-9]+)[.-]([0-9]+)(?![0-9])',path.stem)
    level=(level_match.group(1)+'.'+level_match.group(2)) if level_match else path.stem.replace('-', '.')
    board,issues=assemble_board(labels,geometry,level,overrides)
    warnings.extend(issues)
    prefix=out/path.stem
    out.mkdir(parents=True,exist_ok=True)
    (out/(path.stem+'.json')).write_text(json.dumps(board,indent=2)+'\n',encoding='utf8')
    review_image(im,geometry,labels,confidence,prefix.with_name(prefix.name+'_review.png'))
    diagnostic={'source':str(path),'grid':vars(geometry),'warnings':warnings,'cells':stats,
                'notes':'Review every screenshot, including confident predictions. Correct cells using overrides.'}
    (prefix.with_name(prefix.name+'_diagnostics.json')).write_text(json.dumps(diagnostic,indent=2)+'\n',encoding='utf8')
    code_path=None
    if write_codes and not warnings:
        try:
            from encode_k3 import encode
            code=encode(board)
            code_path=out/(path.stem+'.k3.txt')
            code_path.write_text(code+'\n',encoding='utf8')
        except Exception as exc:
            warnings.append('K3 encoding failed: '+str(exc))
    return geometry,board,warnings,code_path


def main():
    ap=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('images',nargs='+',type=Path,help='Screenshots or directories')
    ap.add_argument('-o','--output',type=Path,default=Path('parsed'))
    ap.add_argument('--grid',help='Override detection: LEFT,TOP,CELL,COLS,ROWS (image pixels)')
    ap.add_argument('--templates',type=Path,help='Optional reference tiles folder, e.g. ball_G.png')
    ap.add_argument('--overrides',type=Path,help='JSON file with {"cells":{"1,2":"ball_G"},...}; for batches use per-image subobjects')
    ap.add_argument('--no-code',action='store_true',help='Skip automatic K3 encoding')
    args=ap.parse_args()
    paths=[]
    for item in args.images:
        if item.is_dir():paths.extend(p for p in sorted(item.iterdir()) if p.suffix.lower() in ('.jpg','.jpeg','.png','.webp'))
        else:paths.append(item)
    if not paths:ap.error('No screenshots found')
    all_overrides=json.loads(args.overrides.read_text()) if args.overrides else {}
    templates=load_templates(args.templates)
    failures=0
    for path in paths:
        try:
            ov=all_overrides.get(path.stem,all_overrides) if 'cells' not in all_overrides else all_overrides
            geom,board,warnings,code_path=parse_one(path,args.output,args.grid,templates,ov,not args.no_code)
            recognition=[w for w in warnings if w.startswith(('Cell (','Unrecognized object','No balls detected')) or 'balls but only' in w]
            mechanics=[w for w in warnings if w not in recognition]
            print(f'{path.name}: {geom.width}x{geom.height}, cell={geom.cell:.2f}px, '
                  f'{len(board["balls"])} balls, {len(board["goals"])} goals, '
                  f'{len(board["teleports"])} teleport pairs, '
                  f'{len(recognition)} recognition warnings, {len(mechanics)} mechanics pending'+(' [K3 generated]' if code_path else ''))
            for w in warnings[:10]:print('  ! '+w)
            if len(warnings)>10:print(f'  ... {len(warnings)-10} more')
            if warnings:failures+=1
        except Exception as e:
            failures+=1;print(f'{path.name}: ERROR: {e}',file=sys.stderr)
    print(f'Finished {len(paths)} screenshots; {failures} require review/errors. Outputs in {args.output}/')
    return 0 if not failures else 1

if __name__=='__main__':sys.exit(main())
