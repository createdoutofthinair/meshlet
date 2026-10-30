import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {preparePages} from '../scripts/prepare-pages.mjs';

test('Pages revisions keep each script and shader together across deployments',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'meshlet-releases-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const root=join(dir,'source'),output=join(dir,'site'),river=join(root,'src','river');await mkdir(river,{recursive:true});
 const page='<link href="./src/river/style.css"><script type="module" src="./src/river/app.js"></script>';
 for(const name of ['index.html','planet.html','river.html','fluid.html','atmosphere.html'])await writeFile(join(root,name),page);
 await writeFile(join(river,'app.js'),"import './renderer.js';");await writeFile(join(river,'renderer.js'),"const entry='makeTerrain';");
 await writeFile(join(river,'world.js'),"fetch(new URL('./geometry.wgsl',import.meta.url));");await writeFile(join(river,'geometry.wgsl'),'fn makeTerrain() {}');
 const a='a'.repeat(40),b='b'.repeat(40);await preparePages({root,output,version:a});
 await writeFile(join(river,'renderer.js'),"const entry='makeRocks';");await writeFile(join(river,'geometry.wgsl'),'fn makeRocks() {}');
 await preparePages({root,output,version:b});
 const html=await readFile(join(output,'river.html'),'utf8');assert.ok(html.includes(`./releases/${b}/src/river/app.js`));assert.ok(html.includes(`./releases/${b}/src/river/style.css`));
 const old=join(output,'releases',a,'src','river'),current=join(output,'releases',b,'src','river');
 assert.match(await readFile(join(old,'renderer.js'),'utf8'),/makeTerrain/);assert.match(await readFile(join(old,'geometry.wgsl'),'utf8'),/makeTerrain/);
 assert.match(await readFile(join(current,'renderer.js'),'utf8'),/makeRocks/);assert.match(await readFile(join(current,'geometry.wgsl'),'utf8'),/makeRocks/);
 assert.equal(await readFile(join(output,'releases',b,'river.html'),'utf8'),page,'versioned page keeps its own relative asset paths');
});

test('a clean Pages build retains the preceding committed asset tree',async t=>{
 const output=await mkdtemp(join(tmpdir(),'meshlet-history-'));t.after(()=>rm(output,{recursive:true,force:true}));
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),previous=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 await preparePages({root,output,version:'f'.repeat(40),previous:[previous]});
 const shader=await readFile(join(output,'releases',previous,'src','river','geometry.wgsl'),'utf8');
 assert.match(shader,/fn\s+makeRocks\s*\(/);assert.ok((await readFile(join(output,'releases',previous,'river.html'),'utf8')).includes('./src/river/app.js'));
});


test('Pages release includes the river simulation shader used by the renderer',async t=>{
 const output=await mkdtemp(join(tmpdir(),'meshlet-river-shader-'));t.after(()=>rm(output,{recursive:true,force:true}));
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),version='e'.repeat(40);
 await preparePages({root,output,version});
 const release=join(output,'releases',version,'src','river');
 assert.match(await readFile(join(release,'renderer.js'),'utf8'),/\.\/simulation\.wgsl/);
 assert.match(await readFile(join(release,'simulation.wgsl'),'utf8'),/@compute[^]*fn\s+stepFluid/);
});
