import test from 'node:test';
import assert from 'node:assert/strict';
import {checkBitwiseArithmetic} from '../scripts/check-wgsl-bitwise.mjs';

test('browser-incompatible bitwise and arithmetic combinations are rejected',()=>{
 for(const expr of ['x^(y+1u)*7u','a & b + c','a * b | c','x ^ a / b','a % b & c']){
  assert.ok(checkBitwiseArithmetic(`fn sample(){ let result=${expr}; }`).length,expr);
 }
});

test('parenthesized combinations, function arguments and comments remain valid',()=>{
 for(const expr of ['x^((y+1u)*7u)','a & (b+c)','(a*b) | c','hash(a+b) ^ c','a ^ -b','x ^ (y >> 2u)']){
  assert.deepEqual(checkBitwiseArithmetic(`fn sample(){ let result=${expr}; }`),[],expr);
 }
 assert.deepEqual(checkBitwiseArithmetic('fn sample(){let x=a^b; /* ^ * /* + & */ */ let y=c*d; // ^ *\n}'),[]);
});
