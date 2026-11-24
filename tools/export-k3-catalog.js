'use strict';
// Writes a K3-format catalog (`id = K3.<code>`, solution embedded) from levels.js, for tools that still read K3 only
// (native solver `--catalog`, Solver/tests) until the solver learns K4.   node tools/export-k3-catalog.js out.txt
const fs=require('fs'),vm=require('vm'),path=require('path');
const repo=path.join(__dirname,'..'),out=process.argv[2];if(!out){console.error('usage: node tools/export-k3-catalog.js OUTPUT_FILE');process.exit(1);}
const ctx={TextEncoder,TextDecoder,Uint8Array,URL,URLSearchParams,atob,btoa,window:{}};vm.createContext(ctx);
for(const f of ['engine.js','codec.js','levels.js','catalog.js'])vm.runInContext(fs.readFileSync(path.join(repo,f),'utf8'),ctx,{filename:f});
const lines=vm.runInContext('Collection.entries.map(({id,code,solution})=>id+" = "+Codec.encodeBoard(Core.validateBoard({...Codec.decodeBoard(code),id,title:"Level "+id,solution})))',ctx);
fs.writeFileSync(out,lines.join('\n')+'\n');console.log(lines.length+' levels written to '+out);
