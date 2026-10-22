import sys, json
sys.path.insert(0,'/home/claude/work/subarray_src/subarray')
import numpy as np
from core import Source, Setup, pressure_room, speed_of_sound, wall_segments
from optimize import Scorer, source_response
src=[Source(-1,0,0,0,1),Source(1,0,0,-2,1),Source(0,-1,2.9,0,-1)]
walls=[{"p":[-8,-4,8,-4],"loss":1.0},{"p":[-8,-4,-8,20,0,26],"loss":3.0}]
c=speed_of_sound(20.0)
st=Setup(sources=src,temp_c=20.0,walls=walls); st.opt['refl_order']=2
xy,amp,dl=st.arrays()
pts=np.array([[0,10],[5,15],[-6,8],[3,-2],[-7,0],[0,25]],float)
out={}
for order in (1,2):
    p=pressure_room(xy,amp,dl,pts,np.array([40.,63.,100.]),c,wall_segments(walls),order)
    out[f'p{order}']=[[ [v.real,v.imag] for v in row] for row in p]
setup=Setup.load('/home/claude/work/subarray_src/subarray/examples/front_back.json')
setup.sources=src; setup.walls=walls; setup.opt['refl_order']=2; setup.opt['temps']=[20.0]
sc=Scorer(setup); on=src; pos=np.array([[s.x,s.y] for s in on])
cost,ms=sc.score(pos, source_response(on, sc.F))
out['A']=sc.A.tolist(); out['Q']=sc.Q.tolist(); out['cost']=cost; out['sum']=sc.summary(ms); out['zones']=setup.zones
json.dump(out,open('walls_ref.json','w')); print(cost, sc.summary(ms))
