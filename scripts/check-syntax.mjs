import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(join(dir,entry.name)):/\.(?:js|mjs)$/.test(entry.name)?[join(dir,entry.name)]:[]);}
const targets=['src','scripts','tests','wasm'].flatMap(files);
for(const path of targets){const result=spawnSync(process.execPath,['--check',path],{encoding:'utf8'});if(result.status!==0){process.stderr.write(result.stderr||`Syntax check failed: ${path}\n`);process.exit(1);}}
console.log(`Checked syntax of ${targets.length} JavaScript modules`);
