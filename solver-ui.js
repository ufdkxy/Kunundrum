// Solver dialog: opened from the "Solver" button in the Replay panel. Runs the WebAssembly solver (kunsolve-bundle.js) in a worker.
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
    s.src = './solver-client.js';
    s.onload = resolve;
    s.onerror = () => { clientPromise = null; reject(new Error('Could not load the solver files.')); };
    document.head.append(s);
  });
  return clientPromise;
}

function setRunning(running) {
  $('solver-solve').disabled = running;
  $('solver-certify').disabled = running || !info?.route;
  $('solver-stop').hidden = !running;
  for (const el of dialog.querySelectorAll('.solver-fields input, .solver-fields select')) el.disabled = running;
  $('solver-algorithm').dispatchEvent(new Event('change'));
}

function readOptions(certifying) {
  const num = id => { const v = $(id).value.trim(); return v === '' ? undefined : Number(v); };
  const o = { algorithm: $('solver-algorithm').value, seconds: num('solver-seconds'), maxMemoryMB: Math.min(1500, num('solver-memory') || 1000),
    maxStates: num('solver-max-states'), maxDepth: num('solver-max-depth'), maxScore: num('solver-max-score') };
  if (o.algorithm === 'beam') { o.beamWidth = num('solver-beam-width'); o.beamHeuristic = $('solver-beam-heuristic').value; }
  if (certifying) o.maxScore = info.route.score - 1;
  return o;
}

function interpret(r, certifying) {
  const saved = info.route, st = r.status || '';
  if (r.error) return { kind: 'bad', title: 'The solver could not finish', note: r.error === 'out of memory' ? 'It ran out of memory. Lower the max states or the memory limit, or use the beam search.' : r.error };
  if (r.hasSolution) {
    const optimal = st === 'OPTIMAL';
    let note = saved ? (r.score < saved.score ? `Better than the current route (score ${saved.score}).` : r.score === saved.score ? 'Same score as the current route.' : `The current route scores ${saved.score}, which is better.`) : '';
    if (!optimal && r.lowerMoves) note += (note ? ' ' : '') + `No route shorter than ${r.lowerMoves} moves exists.`;
    return { kind: optimal ? 'good' : 'warn', title: optimal ? 'Optimal solution found' : 'Solution found, not proven optimal', note };
  }
  let m;
  if ((m = /SCORE <= (-?\d+)/.exec(st))) {
    if (certifying && saved) return { kind: 'good', title: 'Current route certified optimal', note: `No route scores ${m[1]} or less, so the current route's score of ${saved.score} cannot be beaten.` };
    return { kind: 'info', title: `No route scores ${m[1]} or less`, note: r.hasLowerScore ? `The best possible score is at least ${r.lowerScore}.` : '' };
  }
  if ((m = /WITHIN (\d+) MOVES/.exec(st))) return { kind: 'info', title: `No solution within ${m[1]} moves`, note: r.lowerMoves ? `The shortest solution needs at least ${r.lowerMoves} moves.` : '' };
  if (st === 'UNSOLVABLE') return { kind: 'info', title: 'This board has no solution', note: '' };
  if (st === 'INCONCLUSIVE') return { kind: 'warn', title: 'Not decided within the limits', note: (r.lowerMoves ? `So far: at least ${r.lowerMoves} moves are needed. ` : '') + 'Raise the time or memory limit, or try another algorithm.' };
  return { kind: 'info', title: st || 'Finished', note: '' };
}

let lastCode = null; // the board code the running solve was started with (the route is replayed against it)
function showResult(r, certifying) {
  const v = interpret(r, certifying);
  let box = false;
  if (r.hasSolution) {
    const check = window.KunSolver.verifyResult(r, lastCode);
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
  if (!info || (certifying && !info.route)) return;
  const token = ++runToken;
  $('solver-result').hidden = true;
  $('solver-progress').hidden = false;
  $('solver-progress').textContent = 'Starting…';
  setRunning(true);
  try {
    const options = readOptions(certifying);
    await loadClient();
    if (token !== runToken) return;
    lastCode = info.code;
    job = window.KunSolver.solve(info.code, options, p => {
      if (token !== runToken) return;
      const parts = [p.revDepth != null ? `forward depth ${p.fwdDepth ?? '?'} · reverse depth ${p.revDepth}` : p.depth != null ? `depth ${p.depth}` : '', p.states != null ? `${fmt(p.states)} states` : '', p.elapsed != null ? `${p.elapsed.toFixed(1)} s` : ''].filter(Boolean);
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
  const previous = info;
  info = host().prepareSolver();
  const sameBoard = previous && previous.code === info.code;
  $('solver-board').textContent = info.title + (info.route ? ` · current route: ${info.route.moves} moves, score ${info.route.score}` : ' · no complete route');
  $('solver-certify').title = info.route ? 'Prove that no route scores below the current route' : 'The current route is not a solution';
  // Closing only hides the dialog: fields, progress and result stay, unless the board changed meanwhile.
  if (!sameBoard) { $('solver-result').hidden = true; $('solver-progress').hidden = true; }
  setRunning(false);
  dialog.showModal();
  // The bundle's own stamp, i.e. the solver that will actually run (it may be older than the native kunsolve).
  loadClient().then(() => window.KunSolver.loadSource()).then(() => { $('solver-version').textContent = window.KUNSOLVE_VERSION ? 'v' + window.KUNSOLVE_VERSION : ''; }, () => {});
});
$('solver-solve').addEventListener('click', () => run(false));
$('solver-certify').addEventListener('click', () => run(true));
$('solver-stop').addEventListener('click', () => { if (job) job.cancel(); });
$('solver-copy').addEventListener('click', () => host().copy($('solver-solution').value, 'Solution copied.'));
$('solver-algorithm').addEventListener('change', () => {
  const beam = $('solver-algorithm').value === 'beam', locked = $('solver-stop').hidden === false;
  $('solver-beam-width').disabled = locked || !beam; $('solver-beam-heuristic').disabled = locked || !beam;
});
// Closing the dialog (button, Escape) hides it and abandons any running search; nothing is cleared.
dialog.addEventListener('close', () => {
  if (!job) return;
  runToken++; job.cancel(); job = null; setRunning(false);
  $('solver-progress').hidden = false; $('solver-progress').textContent = 'Stopped.';
});
})();
