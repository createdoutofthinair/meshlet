// A tiny, deterministic WebAssembly binary builder for our one bounds kernel.
// No compiler or build dependency is required. The algorithm is described in
// bounds.md. The generated module imports memory and exports build_bounds.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const u = n => { const a=[]; do { let b=n & 127; n=Math.floor(n/128); if(n) b|=128; a.push(b); } while(n); return a; };
const s = n => { const a=[]; let more=true; while(more) { let b=n&127; n >>= 7; more=!((n===0 && !(b&64)) || (n===-1 && (b&64))); if(more)b|=128; a.push(b); } return a; };
const str = x => [...u(Buffer.byteLength(x)), ...Buffer.from(x)];
const section = (id, bytes) => [id,...u(bytes.length),...bytes];
const f32 = n => { const b=Buffer.alloc(4); b.writeFloatLE(n); return [...b]; };
const L = i => [0x20,...u(i)], S = i => [0x21,...u(i)], T = i => [0x22,...u(i)];
const C = n => [0x41,...s(n)], F = n => [0x43,...f32(n)];
const op = (...parts) => parts.flat(Infinity);
const loadf = offset => [0x2a,2,...u(offset)];
const storef = offset => [0x38,2,...u(offset)];
// params: vertex base, index base, index count, output base
// locals: i, ptr, min xyz, max xyz, value, half extent xyz
const [i,ptr,minx,miny,minz,maxx,maxy,maxz,value,dx,dy,dz] = [4,5,6,7,8,9,10,11,12,13,14,15];
let body = [2, 2,0x7f, 10,0x7d]; // two i32 and ten f32 locals
for (const local of [minx,miny,minz]) body.push(...op(F(Infinity),S(local)));
for (const local of [maxx,maxy,maxz]) body.push(...op(F(-Infinity),S(local)));
body.push(...op(C(0),S(i), [0x02,0x40], [0x03,0x40], L(i),L(2),0x4f,[0x0d,1]));
// ptr = vertices + indices[i] * 32. Vertices are two vec4<f32> records.
body.push(...op(L(0), L(1),L(i),C(2),0x74,0x6a,[0x28,2,0],C(5),0x74,0x6a,S(ptr)));
for (const [offset,lo,hi] of [[0,minx,maxx],[4,miny,maxy],[8,minz,maxz]]) {
 body.push(...op(L(ptr),loadf(offset),T(value),L(lo),0x96,S(lo), L(value),L(hi),0x97,S(hi)));
}
body.push(...op(L(i),C(1),0x6a,S(i),[0x0c,0],0x0b,0x0b));
for (const [offset,lo,hi,d] of [[0,minx,maxx,dx],[4,miny,maxy,dy],[8,minz,maxz,dz]]) {
 body.push(...op(L(3),L(lo),L(hi),0x92,F(.5),0x94,storef(offset)));
 body.push(...op(L(hi),L(lo),0x93,F(.5),0x94,S(d)));
}
// Conservative radius = length(half AABB diagonal), with floating-point margin.
body.push(...op(L(3),L(dx),L(dx),0x94,L(dy),L(dy),0x94,0x92,L(dz),L(dz),0x94,0x92,0x91,F(1.00001),0x94,F(.00001),0x92,storef(12),0x0b));
const type = [1,0x60,4,0x7f,0x7f,0x7f,0x7f,0];
const imports = [1,...str('env'),...str('memory'),2,0,0];
const funcs = [1,0];
const exports = [1,...str('build_bounds'),0,0];
const code = [1,...u(body.length),...body];
const binary = new Uint8Array([0,97,115,109,1,0,0,0,...section(1,type),...section(2,imports),...section(3,funcs),...section(7,exports),...section(10,code)]);
if (!WebAssembly.validate(binary)) throw new Error('Generated WASM module failed validation');
writeFileSync(fileURLToPath(new URL('../src/geometry/bounds.wasm', import.meta.url)), binary);
console.log(`Built bounds.wasm (${binary.length} bytes)`);
