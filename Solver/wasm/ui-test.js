'use strict';
// Phase 3 check: the Solver dialog of the app in real Chromium from file:// (Playwright, dev only). Run from Solver/: node wasm/ui-test.js [screenshot.png]
const path=require('path'),assert=require('assert');const {chromium}=require('playwright');
const root=path.join(__dirname,'..','..');
(async()=>{const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const open=async (id,withRoute=false)=>{await page.goto('file://'+path.join(root,'index.html')+'#level='+id);await page.reload();await page.waitForSelector('#open-solver');if(withRoute)await page.keyboard.press('Shift+S');await page.click('#open-solver');await page.waitForSelector('#solver-dialog[open]');};
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
 assert(/Optimal solution found: score 18, 18 moves/.test(v),v);assert(/Same score as the current route/.test(n)&&/Verified by replaying/.test(n),n);assert(/^[A-Za-z][A-Za-z0-9]*$/.test(sol),sol); // notation without separators since 4.5.0
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
 // 5b. the board code box: default is the start board; custom and invalid codes; "Current position" after stepping along the route
 await open('6.6',true);
 const startCode=await page.inputValue('#solver-code');assert(/^K4\./.test(startCode),startCode);
 assert(/Start board/.test(await text('#solver-code-help')));assert(await page.isEnabled('#solver-certify'));assert(await page.isDisabled('#solver-use-position'),'at move 0 the position is the start board');
 await page.fill('#solver-code','garbage');assert(await page.isVisible('#solver-code-error'));assert(await page.isDisabled('#solver-solve'));
 const other=await page.evaluate(()=>window.KUNUNDRUM_LEVEL_CODES.split('\n').find(l=>l.startsWith('1.1 = ')).slice(6));
 await page.fill('#solver-code',other);assert(await page.isHidden('#solver-code-error'));assert(/Custom board.*ignored/.test(await text('#solver-code-help')),await text('#solver-code-help'));
 assert(await page.isEnabled('#solver-solve')&&await page.isDisabled('#solver-certify'),'Certify only applies to the start board');
 await page.click('#solver-solve');await page.waitForSelector('#solver-result:not([hidden])',{timeout:60000});assert(/Optimal solution found/.test(await text('#solver-verdict')),await text('#solver-verdict'));
 assert(!/current route/.test(await text('#solver-note')),'the saved route is not compared on a custom board');
 await page.click('#solver-use-start');assert.equal(await page.inputValue('#solver-code'),startCode);assert(await page.isEnabled('#solver-certify'));assert(await page.isHidden('#solver-result')===true);
 await page.keyboard.press('Escape');await page.waitForSelector('#solver-dialog:not([open])',{state:'attached'});
 await page.click('#replay-next');await page.click('#replay-next');
 await page.click('#open-solver');await page.waitForSelector('#solver-dialog[open]');assert.equal(await page.inputValue('#solver-code'),startCode,'the box keeps its content while the start board is unchanged');
 await page.click('#solver-use-position');assert.notEqual(await page.inputValue('#solver-code'),startCode);assert(/Position after move 2 of/.test(await text('#solver-code-help')),await text('#solver-code-help'));assert(await page.isDisabled('#solver-certify'));
 await page.click('#solver-solve');await page.waitForSelector('#solver-result:not([hidden])',{timeout:60000});assert(/Optimal solution found/.test(await text('#solver-verdict')),await text('#solver-verdict'));
 await page.keyboard.press('Escape');
 // 6. editing disables the button
 await page.click('#edit-mode-button');assert(await page.isDisabled('#open-solver'),'solver button should be disabled while editing');
 await page.click('#edit-mode-button');assert(await page.isEnabled('#open-solver'));
 assert.deepStrictEqual(errors,[],'page errors: '+errors.join(' | '));
 console.log('ui-test: all checks pass');await browser.close();})().catch(e=>{console.log('FAIL',e.message);process.exit(1);});
