import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const port=Number(process.env.PORT || 4173);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.wasm':'application/wasm','.wgsl':'text/plain; charset=utf-8','.json':'application/json'};
createServer(async(req,res)=>{
 try {
  const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(path!==root && !path.startsWith(root+sep)) throw new Error('Invalid path');
  const file=(await stat(path)).isDirectory()?resolve(path,'index.html'):path;
  res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
  res.end(await readFile(file));
 } catch {res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`Meshlet benchmark: http://localhost:${port}`));
