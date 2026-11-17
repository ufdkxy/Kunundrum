// Solver dialog: opened from the "Solver" button in the Replay panel. Runs the WebAssembly solver (Solver/wasm) in a worker.
// The dialog is modal and the global key handler ignores input while a dialog is open, so no moves can be made while it runs;
// closing the dialog (button or Escape) stops the search. The button is disabled while the board editor is active (editor.js).
(() => {
'use strict';
const $ = id => document.getElementById(id);
const host = () => window.KunundrumHost;
const dialog = $('solver-dialog');
let info = null, job = null, runToken = 0, clientPromise = null;
const fmt = n => Number(n).toLocaleString('en-US');

function loadClient() {
  if (window.KunSolver) return Promise.resolve();
  if (!clientPromise) clientPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = './Solver/wasm/solver-client.js';
    s.onload = resolve;
    s.onerror = () => { clientPromise = null; reject(new Error('Could not load the solver files (Solver/wasm).')); };
    document.head.append(s);
  });
  return clientPromise;
}

function setRunning(running) {
  $('solver-solve').disabled = running;
  $('solver-certify').disabled = running || !info?.saved;
  $('solver-stop').hidden = !running;
  for (const el of dialog.querySelectorAll('.solver-fields input, .solver-fields select')) el.disabled = running;
  $('solver-algorithm').dispatchEvent(new Event('change'));
}

function readOptions(certifying) {
  const num = id => { const v = $(id).value.trim(); return v === '' ? undefined : Number(v); };
  const o = { algorithm: $('solver-algorithm').value, seconds: num('solver-seconds'), maxMemoryMB: Math.min(1500, num('solver-memory') || 1000),
    maxStates: num('solver-max-states'), maxDepth: num('solver-max-depth'), maxScore: num('solver-max-score') };
  if (o.algorithm === 'beam') { o.beamWidth = num('solver-beam-width'); o.beamHeuristic = $('solver-beam-heuristic').value; }
  if (certifying) o.maxScore = info.saved.score - 1;
  return o;
}

function interpret(r, certifying) {
  const saved = info.saved, st = r.status || '';
  if (r.error) return { kind: 'bad', title: 'The solver could not finish', note: r.error === 'out of memory' ? 'It ran out of memory. Lower the max states or the memory limit, or use the beam search.' : r.error };
  if (r.hasSolution) {
    const optimal = st === 'OPTIMAL';
    let note = saved ? (r.score < saved.score ? `Better than your saved solution (score ${saved.score}).` : r.score === saved.score ? 'Same score as your saved solution.' : `Your saved solution scores ${saved.score}, which is better.`) : '';
    if (!optimal && r.lowerMoves) note += (note ? ' ' : '') + `No route shorter than ${r.lowerMoves} moves exists.`;
    return { kind: optimal ? 'good' : 'warn', title: optimal ? 'Optimal solution found' : 'Solution found, not proven optimal', note };
  }
  let m;
  if ((m = /SCORE <= (-?\d+)/.exec(st))) {
    if (certifying && saved) return { kind: 'good', title: 'Saved solution certified optimal', note: `No route scores ${m[1]} or less, so the saved score of ${saved.score} cannot be beaten.` };
    return { kind: 'info', title: `No route scores ${m[1]} or less`, note: r.hasLowerScore ? `The best possible score is at least ${r.lowerScore}.` : '' };
  }
  if ((m = /WITHIN (\d+) MOVES/.exec(st))) return { kind: 'info', title: `No solution within ${m[1]} moves`, note: r.lowerMoves ? `The shortest solution needs at least ${r.lowerMoves} moves.` : '' };
  if (st === 'UNSOLVABLE') return { kind: 'info', title: 'This board has no solution', note: '' };
  if (st === 'INCONCLUSIVE') return { kind: 'warn', title: 'Not decided within the limits', note: (r.lowerMoves ? `So far: at least ${r.lowerMoves} moves are needed. ` : '') + 'Raise the time or memory limit, or try another algorithm.' };
  return { kind: 'info', title: st || 'Finished', note: '' };
}

function showResult(r, certifying) {
  const v = interpret(r, certifying);
  let box = false;
  if (r.hasSolution) {
    const check = window.KunSolver.verifyResult(r);
    if (!check.ok) { v.kind = 'bad'; v.title = 'The solver returned a route that does not replay'; v.note = 'Do not use it. ' + (check.error || ''); }
    else { box = true; v.note += (v.note ? ' ' : '') + 'Verified by replaying the route in the game.'; }
  }
  $('solver-progress').hidden = true;
  $('solver-result').hidden = false;
  $('solver-verdict').textContent = v.title + (box ? `: score ${r.score}, ${r.moves} moves` : '');
  $('solver-verdict').dataset.kind = v.kind;
  $('solver-note').textContent = v.note;
  $('solver-note').hidden = !v.note;
  $('solver-stats').textContent = `${fmt(r.states)} states · ${r.elapsed.toFixed(1)} s · ${r.memoryMB} MB · ${r.algorithm}`;
  $('solver-solution-box').hidden = !box;
  $('solver-solution').value = box ? r.solution : '';
}

async function run(certifying) {
  if (!info || (certifying && !info.saved)) return;
  const token = ++runToken;
  $('solver-result').hidden = true;
  $('solver-progress').hidden = false;
  $('solver-progress').textContent = 'Starting…';
  setRunning(true);
  try {
    const options = readOptions(certifying);
    await loadClient();
    if (token !== runToken) return;
    job = window.KunSolver.solve(info.code, options, p => {
      if (token !== runToken) return;
      const parts = [p.depth != null ? `depth ${p.depth}` : '', p.states != null ? `${fmt(p.states)} states` : '', p.elapsed != null ? `${p.elapsed.toFixed(1)} s` : ''].filter(Boolean);
      $('solver-progress').textContent = 'Searching… ' + (parts.join(' · ') || p.line);
    });
    const r = await job.promise;
    if (token === runToken) showResult(r, certifying);
  } catch (e) {
    if (token !== runToken) return;
    $('solver-progress').hidden = false;
    $('solver-progress').textContent = e.cancelled ? 'Stopped.' : 'Error: ' + e.message;
  } finally {
    if (token === runToken) { job = null; setRunning(false); }
  }
}

$('open-solver').addEventListener('click', () => {
  if ($('open-solver').disabled || window.KunEditor?.active) return;
  info = host().prepareSolver();
  $('solver-board').textContent = info.title + (info.saved ? ` · saved solution: ${info.saved.moves} moves, score ${info.saved.score}` : ' · no saved solution');
  $('solver-certify').title = info.saved ? 'Prove that no route scores below the saved solution' : 'This board has no saved solution';
  $('solver-result').hidden = true;
  $('solver-progress').hidden = true;
  setRunning(false);
  dialog.showModal();
});
$('solver-solve').addEventListener('click', () => run(false));
$('solver-certify').addEventListener('click', () => run(true));
$('solver-stop').addEventListener('click', () => { if (job) job.cancel(); });
$('solver-copy').addEventListener('click', () => host().copy($('solver-solution').value, 'Solution copied.'));
$('solver-algorithm').addEventListener('change', () => {
  const beam = $('solver-algorithm').value === 'beam', locked = $('solver-stop').hidden === false;
  $('solver-beam-width').disabled = locked || !beam; $('solver-beam-heuristic').disabled = locked || !beam;
});
// Closing the dialog (button, Escape) abandons any running search.
dialog.addEventListener('close', () => { runToken++; if (job) { job.cancel(); job = null; } });
})();
