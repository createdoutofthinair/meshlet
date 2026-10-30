const clamp=x=>Math.max(0,Math.min(1,x));
const length=v=>Math.hypot(...v);
const difference=(a,b)=>a.map((v,i)=>v-b[i]);
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);

// One scalar controls the entire replacement set, including shared edges.
// Measurements size the spatial band and limit each geometry update. There is
// no clock: a stationary viewer never sees a delayed terrain animation.
export function createTransitionControl(camera,{anchor,approaching,previousEye,endpointPixels,targetPixels=.5}){
 const distance=length(difference(camera.eye,anchor));
 const motion=previousEye?difference(camera.eye,previousEye):[0,0,0];
 const directed=length(motion)>Math.max(1e-8,camera.clearance*.001);
 const axis=directed?motion:difference(approaching?anchor:camera.eye,approaching?camera.eye:anchor);
 const norm=length(axis);
 const direction=norm>1e-12?axis.map(v=>v/norm):[1,0,0];
 const target=Math.max(.0001,targetPixels),error=Math.max(0,endpointPixels);
 // Large residuals start with a wider band. Limit its extent so an approaching
 // camera can reach the endpoint before reaching the anchor itself.
 const base=Math.max(.00001,camera.clearance*.2);
 const band=Math.max(.00001,Math.min(Math.max(base,distance*.5),base*Math.sqrt(Math.max(1,error/target))));
 return {anchor,distance,approaching,direction,startEye:[...camera.eye],lastEye:[...camera.eye],band,factor:0,
  endpointPixels:error,targetPixels:target,focalPixels:camera.focalPixels,clearance:Math.max(.0001,camera.clearance),
  estimatedStepPixels:0,estimatedEndpointPixels:error,limited:false};
}

export function advanceTransitionControl(control,camera,targetPixels=control.targetPixels){
 const m=control,travel=dot(difference(camera.eye,m.startEye),m.direction);
 const x=clamp(travel/m.band),desired=x*x*(3-2*x);
 // A measurement belongs to its camera. Scale conservatively for zoom and
 // descent; this is an estimate, not a new GPU screen-space measurement.
 const scale=Math.max(1,camera.focalPixels/m.focalPixels)*Math.max(1,m.clearance/Math.max(.0001,camera.clearance));
 const endpoint=m.endpointPixels*scale;
 const moved=length(difference(camera.eye,m.lastEye))>1e-10;
 const limit=Math.min(1,Math.max(.0001,targetPixels)/Math.max(.0001,endpoint));
 const delta=moved?Math.max(-limit,Math.min(limit,desired-m.factor)):0;
 m.factor=clamp(m.factor+delta);m.lastEye=[...camera.eye];
 m.estimatedStepPixels=Math.abs(delta)*endpoint;m.estimatedEndpointPixels=endpoint;
 m.limited=Math.abs(desired-m.factor)>1e-10;
 return {factor:m.factor,cancel:m.factor===0&&travel < -m.band*.05};
}
