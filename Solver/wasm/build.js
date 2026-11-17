'use strict';
// Builds ../solver.cpp to WebAssembly with Emscripten (em++ must be on PATH: activate emsdk first).
// Output: build/kunsolve.js, a single file with the .wasm embedded as base64 (SINGLE_FILE), so it also works from file://.
const {spawnSync}=require('child_process'),fs=require('fs'),path=require('path');
const out=path.join(__dirname,'build');fs.mkdirSync(out,{recursive:true});
const args=['-O3','-std=c++17','-DNDEBUG','-fexceptions',path.join(__dirname,'..','solver.cpp'),'-o',path.join(out,'kunsolve.js'),
 '-sMODULARIZE=1','-sEXPORT_NAME=createKunsolve','-sINVOKE_RUN=0','-sEXIT_RUNTIME=1','-sSINGLE_FILE=1',
 '-sENVIRONMENT=web,worker,node','-sEXPORTED_RUNTIME_METHODS=callMain,ccall,HEAPU8','-sEXPORTED_FUNCTIONS=_main,_kun_solve',
 '-sALLOW_MEMORY_GROWTH=1','-sINITIAL_MEMORY=67108864','-sMAXIMUM_MEMORY=2147483648','-sSTACK_SIZE=4194304'];
console.log('em++ '+args.join(' '));
const r=spawnSync('em++',args,{stdio:'inherit',shell:process.platform==='win32'});
if(r.error){console.error('Could not run em++ ('+r.error.message+'). Activate Emscripten first (see Solver/wasm/README.md).');process.exit(1);}
if(r.status===0)console.log('OK: '+path.join(out,'kunsolve.js')+' ('+(fs.statSync(path.join(out,'kunsolve.js')).size>>10)+' KB)');
process.exit(r.status===null?1:r.status);
