import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const pages=['index.html','planet.html','river.html','fluid.html'];
const isSha=value=>/^[a-f0-9]{40}$/.test(value);

// Every HTML page, module, worker, WASM file and WGSL shader for a release
// lives under the same immutable revision path. Keep several older revisions
// for tabs whose HTML was cached just before a Pages deployment.
export async function preparePages({root,output,version,previous=[]}){
 if(!isSha(version)||previous.some(value=>!isSha(value)))throw new Error('Release revisions must be full Git commit SHAs');
 await mkdir(output,{recursive:true});
 const release=join(output,'releases',version);await mkdir(release,{recursive:true});
 await cp(join(root,'src'),join(release,'src'),{recursive:true});
 // Old, already-cached pages still refer to this path during the transition.
 await cp(join(root,'src'),join(output,'src'),{recursive:true});
 for(const page of pages){
  const content=await readFile(join(root,page),'utf8');
  await writeFile(join(release,page),content);
  await writeFile(join(output,page),content.replaceAll('="./src/',`="./releases/${version}/src/`));
 }
 for(const revision of new Set(previous)){
  if(revision===version)continue;
  const target=join(output,'releases',revision);await mkdir(target,{recursive:true});
  const archive=execFileSync('git',['archive',revision,'src'],{cwd:root,maxBuffer:64*1024*1024});
  execFileSync('tar',['-xf','-','-C',target],{input:archive});
  for(const page of pages){
   const exists=spawnSync('git',['cat-file','-e',`${revision}:${page}`],{cwd:root,stdio:'ignore'});
   if(exists.status===0)await writeFile(join(target,page),execFileSync('git',['show',`${revision}:${page}`],{cwd:root}));
  }
 }
}

async function main(){
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
 const versions=execFileSync('git',['rev-list','--first-parent','--max-count=8','HEAD'],{cwd:root,encoding:'utf8'}).trim().split('\n');
 const version=versions[0];if(process.env.GITHUB_SHA&&process.env.GITHUB_SHA!==version)throw new Error('Pages checkout does not match the workflow commit');
 await preparePages({root,output:join(root,'site'),version,previous:versions.slice(1)});
 console.log(`Prepared Pages release ${version} with ${versions.length-1} previous revisions`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
