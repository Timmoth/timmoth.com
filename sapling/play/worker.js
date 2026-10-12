// Sapling browser worker: hosts the .NET/Wasm engine behind [JSExport] bindings and runs
// search in bounded slices. Between slices the worker awaits a macrotask tick so its event
// loop can receive stop/new-game messages; a synchronous search would otherwise block them.
//
// The host drives a RESUMABLE session (Phase 4.4/4.3): each SearchSlice continues the same
// iterative-deepening search with all state preserved (transposition table, killers, history,
// PV, accumulators). A slice stops at a node budget and/or wall-clock deadline, so deep
// iterations no longer block the event loop and cancellation is honoured within a slice.
// Resumability is per-iteration (an interrupted iteration is resumed warm, not re-run cold);
// full intra-node frame serialisation is not implemented. See docs/cross-platform/phase-4-browser.md.

let host = null;
const stopFlags = new Set();
let currentRequest = 0;

function post(msg) { self.postMessage(msg); }
function parse(s) {
  try { return JSON.parse(s); }
  catch (e) { return { ok: false, error: 'bad-json', message: String(e) }; }
}

async function boot() {
  const { dotnet } = await import('./_framework/dotnet.js');
  const runtime = await dotnet.withDiagnosticTracing(false).create();
  const config = runtime.getConfig();
  const exports = await runtime.getAssemblyExports(config.mainAssemblyName);
  host = exports.Sapling.WebHost.EngineHost;
}

try {
  await boot();
  post({ type: 'booted', ok: true });
} catch (e) {
  post({ type: 'failed', error: 'boot', message: String(e && e.message || e) });
}

self.onmessage = async (event) => {
  const m = event.data || {};
  if (!host && m.type !== 'dispose') {
    post({ type: 'failed', error: 'not-booted', message: 'Engine runtime is not available.' });
    return;
  }
  switch (m.type) {
    case 'init': {
      const r = parse(host.Initialize(m.ttMb | 0));
      post({ type: 'ready', ...r });
      break;
    }
    case 'position': {
      post({ type: 'position', ...parse(host.SetPosition(String(m.fen || ''))) });
      break;
    }
    case 'move': {
      post({ type: 'position', ...parse(host.ApplyMove(String(m.uci || ''))) });
      break;
    }
    case 'pgn': {
      post({ type: 'pgn', ...parse(host.Pgn()) });
      break;
    }
    case 'humanelo': {
      post({ type: 'humanelo', ...parse(host.SetHumanElo(m.elo | 0)) });
      break;
    }
    case 'newgame': {
      stopFlags.add(currentRequest);
      post({ type: 'position', ...parse(host.NewGame()) });
      break;
    }
    case 'stop': {
      stopFlags.add(m.requestId | 0);
      post({ type: 'stopped', ...parse(host.Stop(m.requestId | 0)) });
      break;
    }
    case 'search': {
      await runSearch(m);
      break;
    }
    case 'dispose': {
      if (host) post({ type: 'disposed', ...parse(host.Dispose()) });
      host = null;
      break;
    }
    default:
      post({ type: 'failed', error: 'unknown-message', message: m.type });
  }
};

async function runSearch(req) {
  const id = req.requestId | 0;
  currentRequest = id;
  stopFlags.delete(id);

  const start = parse(host.StartSearch(id, req.maxDepth | 0, req.sliceNodes | 0, req.totalNodes | 0, req.timeMs | 0));
  if (!start.ok) { post({ type: 'failed', requestId: id, ...start }); return; }

  let best = null;
  let lastPost = 0;
  while (true) {
    const p = parse(host.SearchSlice(id));
    if (!p.ok) {
      if (p.state === 'obsolete') return; // superseded by a newer request
      post({ type: 'failed', requestId: id, ...p });
      return;
    }
    if ((p.bestDepth ?? -1) > (best ? best.bestDepth : -1)) best = p;

    const now = performance.now();
    if (p.done || now - lastPost > 120) { post({ type: 'progress', ...p }); lastPost = now; }

    if (p.done || stopFlags.has(id)) break;
    // Yield to the worker event loop so stop/new-game postMessages are processed.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const fin = parse(host.Stop(id));
  const chosen = best || fin;
  post({
    type: 'completed',
    requestId: id,
    stopped: stopFlags.has(id),
    bestMove: chosen.bestMove || '',
    bestDepth: chosen.bestDepth || 0,
    scoreType: chosen.scoreType,
    score: chosen.score,
    pv: chosen.pv || [],
    nodesTotal: chosen.nodesTotal || 0,
  });
}
