'use strict';
// Regression tests for the v0.24 predecessor fixes and for --split-depth (real catalog levels only).
// 24.1: v0.23 certified 14 moves (optimum 13); 8.6: v0.23 failed to rebuild its route. 10.8: split search must agree with the plain bidirectional search.
const assert=require('assert'),path=require('path');const {spawnSync}=require('child_process');
const base=path.join(__dirname,'..'),catalog=path.join(base,'..','levels.js');
function run(level,extra=[]){const p=spawnSync(path.join(base,'kunsolve'),['--level',level,'--catalog',catalog,'--algorithm','bidirectional','--quiet','--seconds','60','--max-states','0',...extra],{encoding:'utf8',timeout:90000});
 return {status:(p.stdout.match(/^(OPTIMAL|UNSOLVABLE|INCONCLUSIVE|SOLUTION FOUND|NO SOLUTION)/m)||[])[1],moves:+((p.stdout.match(/^Moves: (\d+)/m)||[])[1]||-1),out:p.stdout+p.stderr};}
for(const [level,moves] of [['24.1',13],['8.6',17],['10.8',28]]){const r=run(level);assert.equal(r.status,'OPTIMAL',level+'\n'+r.out);assert.equal(r.moves,moves,level);console.log('PASS '+level+' bidirectional optimum '+moves);}
for(const [P,R] of [[1,8],[2,6]]){const r=run('10.8',['--split-depth',String(P),'--reverse-depth',String(R)]);assert.equal(r.status,'OPTIMAL',r.out);assert.equal(r.moves,28);console.log('PASS 10.8 --split-depth '+P+' --reverse-depth '+R+' optimum 28');}
{const r=run('10.8',['--split-depth','2','--reverse-depth','8','--max-depth','27']);assert.equal(r.status,'NO SOLUTION');assert.match(r.out,/Lower bound: at least 28 moves/);console.log('PASS 10.8 split bound proof (none within 27)');}
{const r=run('24.1',['--split-depth','2','--reverse-depth','5']);assert.equal(r.status,'OPTIMAL',r.out);assert.equal(r.moves,13);console.log('PASS 24.1 --split-depth 2 optimum 13');}
