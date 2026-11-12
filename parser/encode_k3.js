#!/usr/bin/env node
/* Invoke the unmodified Replay Lab K3 implementation for a single board JSON. */
'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..'); // shared engine.js/codec.js live in the repo root
const source = fs.readFileSync(path.join(root, 'engine.js'), 'utf8') + '\n' +
               fs.readFileSync(path.join(root, 'codec.js'), 'utf8') + '\n' +
               'globalThis.__kunundrum = { Core, Codec };';
vm.runInThisContext(source, {filename:'ReplayLabEngineAndCodec.js',timeout:10000});
const input = process.argv[2];
if (!input) { console.error('Usage: node encode_k3.js board.json');process.exit(2); }
try {
 const board=JSON.parse(fs.readFileSync(input,'utf8'));
 const {Core,Codec}=globalThis.__kunundrum;
 console.log(Codec.encodeBoard(Core.validateBoard(board)));
} catch(e) {console.error('Board rejected:',e.message);process.exit(1);}
