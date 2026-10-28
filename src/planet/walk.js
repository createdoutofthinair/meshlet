import {RADIUS_KM,add,scale,cross,normalize} from './planet-math.js';

export const WALK_EYE_HEIGHT_KM=.0017;
const WALK_SPEED_KM=.0016,FAST_SPEED_KM=.004;

export function directionFromCamera(camera){
 const cl=Math.cos(camera.latitude);
 return [cl*Math.cos(camera.longitude),Math.sin(camera.latitude),cl*Math.sin(camera.longitude)];
}
export function setCameraDirection(camera,direction){
 const d=normalize(direction);
 camera.longitude=Math.atan2(d[2],d[0]);camera.latitude=Math.atan2(d[1],Math.hypot(d[0],d[2]));
}
// A tangent movement followed by a great-circle step keeps speed independent
// of latitude and works across cube-face boundaries and the poles.
export function walkStep(direction,heading,forward,strafe,distanceKm){
 const radial=normalize(direction),east=normalize(cross([0,1,0],radial));
 const localEast=Math.hypot(...east)>0?east:[0,0,-1];
 const north=normalize(cross(radial,localEast));
 const ahead=add(scale(north,Math.cos(heading)),scale(localEast,Math.sin(heading)));
 const right=add(scale(localEast,Math.cos(heading)),scale(north,-Math.sin(heading)));
 const movement=normalize(add(scale(ahead,forward),scale(right,strafe)));
 if(!Math.hypot(...movement)||distanceKm<=0)return radial;
 const angle=distanceKm/RADIUS_KM;
 return normalize(add(scale(radial,Math.cos(angle)),scale(movement,Math.sin(angle))));
}
const sameInput=(a,b)=>a.forward===b.forward&&a.strafe===b.strafe&&a.fast===b.fast;

// Movement is divided into short, GPU-probed segments. The camera stays at
// eye height over the sampled render mesh rather than following an unrelated
// LOD-dependent approximation of the terrain.
export class SurfaceWalker {
 constructor(renderer,readInput,onError){this.renderer=renderer;this.readInput=readInput;this.onError=onError;this.epoch=0;this.active=false;}
 start(){this.epoch++;this.active=true;this.pending=false;this.grounded=false;this.segment=null;this.lastSampleSelection=-1;}
 stop(){this.epoch++;this.active=false;this.pending=false;this.segment=null;}
 advance(now){
  if(!this.active||!this.segment)return;
  const input=this.readInput(),segment=this.segment;
  if(!input.forward&&!input.strafe){this.segment=null;return;}
  if(segment.start===null)segment.start=now;
  const t=Math.max(0,Math.min(1,(now-segment.start)/segment.duration));
  const direction=normalize(add(scale(segment.from,1-t),scale(segment.to,t)));
  const camera=this.renderer.cameraState;setCameraDirection(camera,direction);
  camera.surfaceHeight=segment.fromHeight+(segment.toHeight-segment.fromHeight)*t;
  this.renderer.needsSelection=true;
  if(t>=1)this.segment=null;
 }
 afterFrame(){
  if(!this.active||this.pending||this.segment)return;
  const input=this.readInput(),moving=!!(input.forward||input.strafe);
  const settle=!this.grounded||(!moving&&this.lastSampleSelection!==this.renderer.lastSelection);
  if(!settle&&!moving)return;
  const camera=this.renderer.cameraState,from=directionFromCamera(camera);
  const distance=input.fast?.0007:.00035,speed=input.fast?FAST_SPEED_KM:WALK_SPEED_KM;
  const to=settle?from:walkStep(from,camera.heading,input.forward,input.strafe,distance);
  const epoch=this.epoch,generation=this.renderer.generation,selection=this.renderer.lastSelection,fromHeight=camera.surfaceHeight;
  this.pending=true;
  this.renderer.sampleRenderedSurface(to).then(height=>{
   if(!this.active||epoch!==this.epoch)return;
   if(generation!==this.renderer.generation){this.grounded=false;return;}
   if(height==null||!Number.isFinite(height))return;
   if(settle){
    if(Math.abs(camera.surfaceHeight-height)>.00001)this.renderer.needsSelection=true;
    camera.surfaceHeight=height;this.grounded=true;this.lastSampleSelection=selection;return;
   }
   if(!sameInput(input,this.readInput()))return;
   this.segment={from,to,fromHeight,toHeight:height,duration:distance/speed*1000,start:null};
  }).catch(error=>{if(this.active&&epoch===this.epoch)this.onError?.(error);}).finally(()=>{if(epoch===this.epoch)this.pending=false;});
 }
}
