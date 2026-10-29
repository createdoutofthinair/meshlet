// WGSL does not implicitly associate binary &, ^ or | with arithmetic. Some
// offline compilers accept those expressions even though browsers reject them.
// This focused lexical check catches that class; it is not a WGSL parser.
export function checkBitwiseArithmetic(source){
 const errors=[],stack=[{operand:false,bitwise:null,arithmetic:null,reported:false}];let line=1,i=0;
 const current=()=>stack[stack.length-1];
 const reset=()=>Object.assign(current(),{operand:false,bitwise:null,arithmetic:null,reported:false});
 const operator=(kind,op)=>{
  const scope=current();scope[kind]||=op;
  if(scope.bitwise&&scope.arithmetic&&!scope.reported){errors.push(`line ${line}: parenthesize arithmetic when mixing '${scope.bitwise}' and '${scope.arithmetic}'`);scope.reported=true;}
  scope.operand=false;
 };
 while(i<source.length){
  const c=source[i];if(c==='\n'){line++;i++;continue;}if(/\s/.test(c)){i++;continue;}
  if(source.startsWith('//',i)){while(i<source.length&&source[i]!=='\n')i++;continue;}
  if(source.startsWith('/*',i)){
   i+=2;let depth=1;while(i<source.length&&depth){if(source.startsWith('/*',i)){depth++;i+=2;}else if(source.startsWith('*/',i)){depth--;i+=2;}else{if(source[i]==='\n')line++;i++;}}continue;
  }
  const word=source.slice(i).match(/^(?:[A-Za-z_][A-Za-z_0-9]*|(?:\d|\.\d)[A-Za-z_0-9.]*)/);
  if(word){current().operand=!['return','let','var','const','override','if','while','for','switch','case'].includes(word[0]);i+=word[0].length;continue;}
  if('([{'.includes(c)){stack.push({operand:false,bitwise:null,arithmetic:null,reported:false});i++;continue;}
  if(')]}'.includes(c)){if(stack.length>1)stack.pop();current().operand=true;i++;continue;}
  const two=source.slice(i,i+2);
  if(['+=','-=','*=','/=','%=','&=','|=','^='].includes(two)){reset();i+=2;continue;}
  if(['&&','||','==','!=','<=','>=','<<','>>','->','++','--'].includes(two)){current().operand=false;i+=2;continue;}
  if('=,;:'.includes(c)){reset();i++;continue;}
  if('^&|'.includes(c)){
   if(current().operand)operator('bitwise',c);else current().operand=false;
  }else if('+-*/%'.includes(c)){
   if(current().operand)operator('arithmetic',c);else current().operand=false;
  }else if(c==='!'||c==='~'){current().operand=false;}
  i++;
 }
 return errors;
}
