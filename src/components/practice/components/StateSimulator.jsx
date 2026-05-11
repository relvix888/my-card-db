/**
 * StateSimulator — dev-only panel for injecting game state during a practice session.
 *
 * Features:
 *  • Card search: add any card to the human player's hand
 *  • Field inject: deploy a character directly to the human's field
 *  • Life control: set human / AI life count
 *  • Phase control: force MAIN phase on the human's turn
 *  • Hand control: clear the human's hand
 *  • Field control: clear the human's character area
 *  • Presets: one-click scenario setup for common card-testing situations
 *
 * All mutations are dispatched as LOAD_STATE actions so they appear in Redux DevTools
 * and support full time-travel.
 */
import React, { useState, useMemo } from 'react';
import { PHASE, PLAYER } from '../engine/constants';
import { getSafeImageUrl } from '../../../utils/cardHelpers';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeFieldCard(card) {
  return { card, state: 'active', attachedDon: 0, justDeployed: false };
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// ─── component ───────────────────────────────────────────────────────────────

export default function StateSimulator({ gameState, allCards, dispatch, onClose }) {
  const [query, setQuery]       = useState('');
  const [tab, setTab]           = useState('hand'); // 'hand' | 'field' | 'life' | 'phase' | 'presets'
  const [targetPlayer, setTargetPlayer] = useState(PLAYER.HUMAN);

  // ── card search results ─────────────────────────────────────────────────────
  const results = useMemo(() => {
    if (!query.trim() || !allCards) return [];
    const q = query.toLowerCase();
    return allCards
      .filter(c =>
        c.name?.toLowerCase().includes(q) ||
        c.id?.toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [query, allCards]);

  // ── LOAD_STATE helpers ──────────────────────────────────────────────────────
  function patch(patchFn) {
    dispatch({ type: 'LOAD_STATE', state: patchFn(gameState) });
  }

  function patchPlayer(owner, playerPatchFn) {
    patch(s => ({ ...s, [owner]: playerPatchFn(s[owner]) }));
  }

  // ── hand actions ───────────────────────────────────────────────────────────
  function addToHand(card) {
    patchPlayer(targetPlayer, ps => ({ ...ps, hand: [...ps.hand, card] }));
  }

  function removeFromHand(owner, idx) {
    patchPlayer(owner, ps => ({ ...ps, hand: ps.hand.filter((_, i) => i !== idx) }));
  }

  function clearHand() {
    patchPlayer(targetPlayer, ps => ({ ...ps, hand: [] }));
  }

  // ── field actions ──────────────────────────────────────────────────────────
  function deployToField(card) {
    patchPlayer(targetPlayer, ps => {
      if (ps.characterArea.length >= 5) return ps;
      return { ...ps, characterArea: [...ps.characterArea, makeFieldCard(card)] };
    });
  }

  function clearField() {
    patchPlayer(targetPlayer, ps => ({ ...ps, characterArea: [] }));
  }

  // ── life actions ──────────────────────────────────────────────────────────
  function setLife(owner, count) {
    patchPlayer(owner, ps => {
      const current = ps.lifeArea.length;
      if (count === current) return ps;
      if (count > current) {
        // Add face-down placeholder cards drawn from deck
        const extra = Math.min(count - current, ps.deck.length);
        const newLife = [...ps.lifeArea, ...ps.deck.slice(-extra)];
        return {
          ...ps,
          lifeArea: newLife,
          lifeAreaFaceUp: [...(ps.lifeAreaFaceUp ?? []), ...Array(extra).fill(false)],
          deck: ps.deck.slice(0, -extra),
        };
      } else {
        // Trim life — removed cards go to trash
        const removed = ps.lifeArea.slice(count);
        return {
          ...ps,
          lifeArea: ps.lifeArea.slice(0, count),
          lifeAreaFaceUp: (ps.lifeAreaFaceUp ?? []).slice(0, count),
          trash: [...ps.trash, ...removed],
        };
      }
    });
  }

  // ── phase / turn ──────────────────────────────────────────────────────────
  function forceMainPhase() {
    patch(s => ({
      ...s,
      phase: PHASE.MAIN,
      activePlayer: PLAYER.HUMAN,
      waitingFor: PLAYER.HUMAN,
      battle: null,
      pendingEffect: null,
      pendingBattle: null,
      pendingTrigger: null,
      mulligan: 'done',
    }));
  }

  // ── presets ────────────────────────────────────────────────────────────────
  const presets = [
    {
      label: 'Test 登場時 (on-play)',
      desc: 'Force MAIN phase + 5 random cards in hand',
      apply() {
        patch(s => {
          const ps = s[PLAYER.HUMAN];
          const drawn = ps.deck.slice(-5);
          return {
            ...s,
            phase: PHASE.MAIN,
            activePlayer: PLAYER.HUMAN,
            waitingFor: PLAYER.HUMAN,
            battle: null, pendingEffect: null, mulligan: 'done',
            [PLAYER.HUMAN]: {
              ...ps,
              hand: drawn,
              deck: ps.deck.slice(0, -5),
            },
          };
        });
      },
    },
    {
      label: 'Test 攻擊時 / 對方攻擊時',
      desc: 'Force MAIN phase + full DON + hand of 5',
      apply() {
        patch(s => {
          const ps = s[PLAYER.HUMAN];
          const drawn = ps.deck.slice(-5);
          const donCount = 10;
          const donDeck  = [];
          const costArea = Array.from({ length: donCount }, (_, i) => ({
            _donId: `sim-don-${i}`,
            state: 'active',
          }));
          return {
            ...s,
            phase: PHASE.MAIN,
            activePlayer: PLAYER.HUMAN,
            waitingFor: PLAYER.HUMAN,
            battle: null, pendingEffect: null, mulligan: 'done',
            [PLAYER.HUMAN]: {
              ...ps,
              hand: drawn,
              deck: ps.deck.slice(0, -5),
              costArea,
              donDeck,
            },
          };
        });
      },
    },
    {
      label: 'Low Life (Human 1 life)',
      desc: 'Set human life to 1 to test damage scenarios',
      apply() { setLife(PLAYER.HUMAN, 1); },
    },
    {
      label: 'Low Life (AI 1 life)',
      desc: 'Set AI life to 1 — one hit wins',
      apply() { setLife(PLAYER.AI, 1); },
    },
    {
      label: 'Clear Human Hand',
      apply() { clearHand(); },
    },
    {
      label: 'Clear Human Field',
      apply() { clearField(); },
    },
  ];

  // ── render ─────────────────────────────────────────────────────────────────
  const ps = gameState?.[targetPlayer];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-slate-950 border-t border-purple-600/50 shadow-2xl"
      style={{ maxHeight: '65vh', display: 'flex', flexDirection: 'column' }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 bg-purple-900/60 border-b border-purple-700/40 flex-shrink-0">
        <span className="text-purple-300 font-black text-xs uppercase tracking-widest">⚙ State Simulator</span>
        {/* Player toggle */}
        <div className="flex gap-1 ml-2">
          {[PLAYER.HUMAN, PLAYER.AI].map(p => (
            <button key={p}
              onClick={() => setTargetPlayer(p)}
              className={`px-2 py-0.5 rounded text-xs font-bold transition-colors
                ${targetPlayer === p ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-white'}`}
            >
              {p === PLAYER.HUMAN ? 'Human' : 'AI'}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2 items-center">
          {/* DevTools hint */}
          <span className="text-slate-500 text-xs hidden sm:block">Redux DevTools ← time-travel in browser ext</span>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none px-1">×</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-4 py-1.5 border-b border-slate-800 flex-shrink-0 overflow-x-auto">
        {[
          { key: 'hand',    label: 'Hand' },
          { key: 'field',   label: 'Field' },
          { key: 'life',    label: 'Life' },
          { key: 'phase',   label: 'Phase' },
          { key: 'presets', label: 'Presets' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1 rounded text-xs font-bold whitespace-nowrap transition-colors
              ${tab === t.key ? 'bg-purple-700 text-white' : 'text-slate-400 hover:text-white'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3">

        {/* ── HAND ── */}
        {tab === 'hand' && (
          <div className="space-y-3">
            {/* Card search */}
            <div className="flex gap-2">
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search card by name or ID…"
                className="flex-1 bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
            </div>
            {/* Search results */}
            {results.length > 0 && (
              <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
                {results.map(card => (
                  <button key={card.id}
                    onClick={() => addToHand(card)}
                    className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 rounded p-2 text-left transition-colors"
                  >
                    <img
                      src={getSafeImageUrl(card.img_url ?? card.img_full_url)}
                      alt={card.name}
                      className="w-8 h-11 object-cover rounded flex-shrink-0"
                      onError={e => { e.target.style.display = 'none'; }}
                    />
                    <div className="min-w-0">
                      <div className="text-white text-xs font-bold truncate">{card.name}</div>
                      <div className="text-slate-400 text-xs">{card.id} · {card.category}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {/* Current hand */}
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-xs font-bold uppercase">
                {targetPlayer === PLAYER.HUMAN ? 'Your' : "AI's"} Hand ({ps?.hand?.length ?? 0})
              </span>
              <button onClick={clearHand} className="text-xs text-red-400 hover:text-red-300 ml-auto">Clear</button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(ps?.hand ?? []).map((card, i) => (
                <button key={i} title={`Remove ${card.name}`}
                  onClick={() => removeFromHand(targetPlayer, i)}
                  className="relative group"
                >
                  <img
                    src={getSafeImageUrl(card.img_url ?? card.img_full_url)}
                    alt={card.name}
                    className="w-10 h-14 object-cover rounded border border-slate-700 group-hover:border-red-500"
                    onError={e => { e.target.style.display = 'none'; }}
                  />
                  <span className="absolute inset-0 flex items-center justify-center text-red-400 opacity-0 group-hover:opacity-100 bg-black/60 rounded text-lg font-black">×</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── FIELD ── */}
        {tab === 'field' && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search character to deploy…"
                className="flex-1 bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
            </div>
            {results.filter(c => c.category === 'Character').length > 0 && (
              <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
                {results.filter(c => c.category === 'Character').map(card => (
                  <button key={card.id} onClick={() => deployToField(card)}
                    className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 rounded p-2 text-left transition-colors"
                  >
                    <img
                      src={getSafeImageUrl(card.img_url ?? card.img_full_url)}
                      alt={card.name}
                      className="w-8 h-11 object-cover rounded flex-shrink-0"
                      onError={e => { e.target.style.display = 'none'; }}
                    />
                    <div className="min-w-0">
                      <div className="text-white text-xs font-bold truncate">{card.name}</div>
                      <div className="text-slate-400 text-xs">{card.id} · {card.power ?? '?'} pw</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-xs font-bold uppercase">
                {targetPlayer === PLAYER.HUMAN ? 'Your' : "AI's"} Field ({ps?.characterArea?.length ?? 0}/5)
              </span>
              <button onClick={clearField} className="text-xs text-red-400 hover:text-red-300 ml-auto">Clear Field</button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(ps?.characterArea ?? []).map((fc, i) => (
                <button key={i} title={`Remove ${fc.card.name}`}
                  onClick={() => patchPlayer(targetPlayer, p => ({
                    ...p, characterArea: p.characterArea.filter((_, ci) => ci !== i)
                  }))}
                  className="relative group"
                >
                  <img
                    src={getSafeImageUrl(fc.card.img_url ?? fc.card.img_full_url)}
                    alt={fc.card.name}
                    className="w-10 h-14 object-cover rounded border border-slate-700 group-hover:border-red-500"
                    onError={e => { e.target.style.display = 'none'; }}
                  />
                  <span className="absolute inset-0 flex items-center justify-center text-red-400 opacity-0 group-hover:opacity-100 bg-black/60 rounded text-lg font-black">×</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── LIFE ── */}
        {tab === 'life' && (
          <div className="space-y-4">
            {[PLAYER.HUMAN, PLAYER.AI].map(owner => {
              const lifeCount = gameState?.[owner]?.lifeArea?.length ?? 0;
              return (
                <div key={owner}>
                  <div className="text-slate-300 text-xs font-bold uppercase mb-2">
                    {owner === PLAYER.HUMAN ? 'Your' : "AI's"} Life: {lifeCount}
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {[0, 1, 2, 3, 4, 5, 6].map(n => (
                      <button key={n} onClick={() => setLife(owner, n)}
                        className={`w-9 h-9 rounded font-black text-sm transition-colors
                          ${lifeCount === n
                            ? 'bg-purple-600 text-white'
                            : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── PHASE ── */}
        {tab === 'phase' && (
          <div className="space-y-3">
            <div className="text-slate-400 text-xs mb-2">
              Current: <span className="text-white font-bold">{gameState?.phase?.toUpperCase()}</span>
              {' '}— active: <span className="text-white font-bold">{gameState?.activePlayer}</span>
            </div>
            <button onClick={forceMainPhase}
              className="w-full py-3 bg-emerald-700 hover:bg-emerald-600 text-white font-black text-sm rounded-xl transition-colors"
            >
              Force MAIN Phase (Your Turn)
            </button>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {['REFRESH','DRAW','DON','MAIN','END'].map(p => (
                <button key={p}
                  onClick={() => patch(s => ({
                    ...s,
                    phase: p.toLowerCase(),
                    activePlayer: PLAYER.HUMAN,
                    waitingFor: PLAYER.HUMAN,
                    battle: null,
                    pendingEffect: null,
                    mulligan: 'done',
                  }))}
                  className={`py-2 rounded text-xs font-bold transition-colors
                    ${gameState?.phase?.toUpperCase() === p
                      ? 'bg-purple-700 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
                >
                  {p}
                </button>
              ))}
            </div>
            <div className="mt-3">
              <div className="text-slate-400 text-xs font-bold uppercase mb-2">Add DON!! to cost area</div>
              <div className="flex gap-1.5 flex-wrap">
                {[1, 2, 3, 5, 10].map(n => (
                  <button key={n} onClick={() => {
                    patchPlayer(targetPlayer, ps2 => ({
                      ...ps2,
                      costArea: [
                        ...ps2.costArea,
                        ...Array.from({ length: n }, (_, i) => ({
                          _donId: `sim-don-${Date.now()}-${i}`,
                          state: 'active',
                        })),
                      ],
                    }));
                  }}
                    className="px-3 py-1.5 bg-yellow-700 hover:bg-yellow-600 text-white rounded text-xs font-bold transition-colors"
                  >
                    +{n} DON
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── PRESETS ── */}
        {tab === 'presets' && (
          <div className="space-y-2">
            {presets.map(p => (
              <button key={p.label} onClick={p.apply}
                className="w-full flex flex-col items-start gap-0.5 p-3 bg-slate-800 hover:bg-slate-700 rounded-xl text-left transition-colors"
              >
                <span className="text-white font-bold text-sm">{p.label}</span>
                {p.desc && <span className="text-slate-400 text-xs">{p.desc}</span>}
              </button>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
