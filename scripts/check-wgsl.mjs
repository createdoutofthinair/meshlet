import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {closeSync,openSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WASI} from 'node:wasi';
import {checkBitwiseArithmetic} from './check-wgsl-bitwise.mjs';

// Naga runs only as a development-time validator, inside a WASI sandbox with
// an empty environment and access to the temporary shader directory only.
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
let wasmPath;
try{wasmPath=join(dirname(require.resolve('naga-wasi-cli/package.json')),'wasi','naga.wasm');}
catch{throw new Error('Shader compiler is missing. Run npm ci before npm run check.');}
const naga=await WebAssembly.compile(await readFile(wasmPath));
const read=async path=>readFile(join(root,path),'utf8');
const planet=async name=>read(`src/planet/${name}.wgsl`);
const [common,core,curve,field,surface]=await Promise.all(['common','terrain-core','river-curve','world-field','terrain-surface'].map(planet));
const covered={
 'src/planet':new Set(['common','terrain-core','river-curve','world-field','terrain-surface','generate','normal','bounds','cull','render','ocean','lod-error','transition-error','hydrology','regional-hydrology','river-detail','walk-probe']),
 'src/river':new Set(['shared','select','geometry','animate','render']),
 'src/gpu':new Set(['common','cull','render','projection'])
};
for(const [folder,names] of Object.entries(covered))for(const filename of await readdir(join(root,folder))){
 if(filename.endsWith('.wgsl')&&!names.has(filename.slice(0,-5)))throw new Error(`Add ${folder}/${filename} to the assembled shader checks`);
}
const full=[common,core,curve,field,surface];
const modules={
 'planet-generate':[...full,await planet('generate')],
 'planet-normal':[...full,await planet('normal')],
 'planet-bounds':[common,await planet('bounds')],
 'planet-cull':[common,await planet('cull')],
 'planet-render':[...full,await planet('render')],
 'planet-ocean':[...full,await planet('ocean')],
 'planet-ocean-smoke':[...full,await planet('ocean'),await read('tests/ocean-smoke.wgsl')],
 'planet-lod-error':[common,await planet('lod-error')],
 'planet-transition-error':[common,await planet('transition-error')],
 'planet-hydrology':[common,core,curve,await planet('hydrology')],
 'planet-regional':[common,core,curve,field.replace('var<storage,read> world:','var<storage,read_write> world:'),await planet('regional-hydrology')],
 'planet-river-detail':[common,curve,field,await planet('river-detail')],
 'planet-walk-probe':[common,await planet('walk-probe')]
};
const riverShared=await read('src/river/shared.wgsl');
for(const name of ['select','geometry','animate','render'])modules[`river-${name}`]=[common,name==='select'?riverShared.replace('var<storage,read> reach:','var<storage,read_write> reach:'):riverShared,await read(`src/river/${name}.wgsl`)];
modules['river-flow-smoke']=[common,riverShared,await read('src/river/render.wgsl'),await read('tests/river-flow-smoke.wgsl')];
const meshletCommon=await read('src/gpu/common.wgsl');
for(const name of ['cull','render','projection'])modules[`meshlet-${name}`]=[meshletCommon,await read(`src/gpu/${name}.wgsl`)];
// The browser smoke tests append their own WGSL to the same source modules.
// Compile that code as well so test-only shader errors cannot go unnoticed.
for(const [name,path,parts,marker] of [['planet-smoke','tests/planet-smoke.js',[...full,await planet('generate')],'const detailModule=device.createShaderModule({code:'],['regional-smoke','tests/regional-smoke.js',[common,curve,field],'const module=device.createShaderModule({code:']]){
 const source=await read(path),start=source.indexOf(marker),begin=source.indexOf('`',start),end=source.indexOf('`});',begin);
 if(start<0||begin<0||end<0)throw new Error(`Could not find the WGSL in ${path}`);
 modules[name]=[...parts,source.slice(begin+1,end)];
}

const directory=await mkdtemp(join(tmpdir(),'meshlet-wgsl-'));
async function validate(name,source){
 const path=join(directory,`${name}.wgsl`),log=join(directory,`${name}.log`);await writeFile(path,source);
 const logFd=openSync(log,'w');let code;
 try{
  const wasi=new WASI({version:'preview1',args:['naga',`/shaders/${name}.wgsl`],env:{},preopens:{'/shaders':directory},stdout:logFd,stderr:logFd,returnOnExit:true});
  const instance=await WebAssembly.instantiate(naga,{wasi_snapshot_preview1:wasi.wasiImport});code=wasi.start(instance);
 }finally{closeSync(logFd);}
 return {code,diagnostics:await readFile(log,'utf8')};
}
try{
 // Exercise the exact failure class that previously escaped the JS checks.
 for(const word of ['precision','precise']){
  const result=await validate(`reserved-${word}`,`@compute @workgroup_size(1) fn main(){let ${word}=1;}`);
  if(result.code===0)throw new Error(`Shader compiler accepted reserved word ${word}`);
 }
 const failures=[];
 for(const [name,parts] of Object.entries(modules)){
  const source=parts.join('\n'),operatorErrors=checkBitwiseArithmetic(source);
  if(operatorErrors.length){failures.push(`${name}:\n${operatorErrors.join('\n')}`);continue;}
  const result=await validate(name,source);
  if(result.code!==0)failures.push(`${name}:\n${result.diagnostics}`);
 }
 if(failures.length)throw new Error(failures.join('\n'));
 console.log(`Validated ${Object.keys(modules).length} assembled WGSL modules with Naga`);
}finally{await rm(directory,{recursive:true,force:true});}
