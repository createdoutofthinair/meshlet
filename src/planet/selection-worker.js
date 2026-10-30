import {selectPatches} from './quadtree.js';
self.onmessage=({data})=>{
 const start=performance.now();
 const result=selectPatches(data.camera,data.options);
 self.postMessage({id:data.id,key:data.key,camera:data.camera,result,selectionMs:performance.now()-start});
};
