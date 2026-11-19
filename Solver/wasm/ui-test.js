'use strict';
// Phase 3 check: the Solver dialog of the app in real Chromium from file:// (Playwright, dev only). Run from Solver/: node wasm/ui-test.js [screenshot.png]
const path=require('path'),assert=require('assert');const {chromium}=require('playwright');
const root=path.join(__dirname,'..','..');
(async()=>{const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const open=async (id,withRoute=false)=>{await page.goto('file://'+path.join(root,'index.html')+'#level='+id);await page.reload();await page.waitForSelector('#open-solver');if(withRoute)await page.click('#use-example');await page.click('#open-solver');await page.waitForSelector('#solver-dialog[open]');};
 const text=id=>page.textContent(id);
 // 1. open on 6.6 with its saved solution loaded as the current route; without a route Certify is disabled
 await open('6.6');assert(/no complete route/.test(await text('#solver-board')));assert(await page.isDisabled('#solver-certify'));await page.keyboard.press('Escape');
 await open('6.6',true);assert(/6\.6/.test(await text('#solver-board')),await text('#solver-board'));assert(/current route: 18 moves, score 18/.test(await text('#solver-board')));
 assert(await page.isEnabled('#solver-certify'));
 // 2. certify -> certified optimal
 await page.click('#solver-certify');await page.waitForSelector('#solver-result:not([hidden])',{timeout:60000});
 assert(/certified optimal/i.test(await text('#solver-verdict')),await text('#solver-verdict'));assert(await page.isHidden('#solver-solution-box'));
 // 3. find best -> optimal, same score as saved, verified, solution present and copyable
 await page.click('#solver-solve');await page.waitForSelector('#solver-result:not([hidden])',{timeout:60000});
 const v=await text('#solver-verdict'),n=await text('#solver-note'),sol=await page.inputValue('#solver-solution');
 assert(/Optimal solution found: score 18, 18 moves/.test(v),v);assert(/Same score as the current route/.test(n)&&/Verified by replaying/.test(n),n);assert(/^[A-Za-z]/.test(sol)&&sol.includes(','),sol);
 await page.screenshot({path:process.argv[2]||'/tmp/solver-dialog.png'});
 await page.click('#solver-copy');await page.waitForTimeout(300);
 // 4. stop a long search
 await page.click('.solver-advanced summary');assert(await page.isDisabled('#solver-beam-width'));
 await page.selectOption('#solver-algorithm','beam');assert(await page.isEnabled('#solver-beam-width')&&await page.isEnabled('#solver-beam-heuristic'));
 await page.selectOption('#solver-algorithm','forward');assert(await page.isDisabled('#solver-beam-width'));
 await page.keyboard.press('Escape');await page.waitForSelector('#solver-dialog:not([open])',{state:'attached'});
 await open('10.9');await page.click('#solver-solve');await page.waitForFunction(()=>/Searching/.test(document.getElementById('solver-progress').textContent),null,{timeout:30000});
 assert(await page.isDisabled('#solver-solve')&&await page.isVisible('#solver-stop')&&await page.isDisabled('#solver-seconds'));
 await page.click('#solver-stop');await page.waitForFunction(()=>document.getElementById('solver-progress').textContent==='Stopped.');assert(await page.isEnabled('#solver-solve'));
 // 5. keyboard moves are blocked while the dialog is open (state unchanged), Escape mid-run closes and stops
 const before=await page.evaluate(()=>document.getElementById('board-stage').innerHTML.length+'|'+localStorage.length);
 await page.click('#solver-solve');await page.waitForFunction(()=>/Searching/.test(document.getElementById('solver-progress').textContent));
 for(const k of ['ArrowRight','ArrowDown','r','Space'])await page.keyboard.press(k);
 await page.keyboard.press('Escape');await page.waitForSelector('#solver-dialog:not([open])',{state:'attached'});
 assert.strictEqual(await page.evaluate(()=>document.getElementById('board-stage').innerHTML.length+'|'+localStorage.length),before,'board changed while solver open');
 await page.click('#open-solver');await page.waitForSelector('#solver-dialog[open]');assert(await page.isEnabled('#solver-solve'));assert(await page.isHidden('#solver-result'));
 await page.keyboard.press('Escape');
 // 6. editing disables the button
 await page.click('#edit-mode-button');assert(await page.isDisabled('#open-solver'),'solver button should be disabled while editing');
 await page.click('#edit-mode-button');assert(await page.isEnabled('#open-solver'));
 assert.deepStrictEqual(errors,[],'page errors: '+errors.join(' | '));
 console.log('ui-test: all checks pass');await browser.close();})().catch(e=>{console.log('FAIL',e.message);process.exit(1);});
