/**
 * StateSimulator — dev-only panel for injecting game state during a practice session.
 *
 * Tabs:
 *  • Hand    — filter/browse all cards by color+category, bulk-add to hand
 *  • Leader  — hot-swap the human leader without resetting hand/deck/field
 *  • Field   — deploy characters directly to field
 *  • Life    — set life count; inject a specific card as the next trigger
 *  • Phase   — force phase/turn; add DON; toggle Passive AI
 *  • Presets — one-click scenario setup
 *  • Trace   — live effect log filtered to effect/trigger entries
 *
 * All game-state mutations are dispatched as LOAD_STATE so they appear in
 * Redux DevTools and support full time-travel.
 */
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { PHASE, PLAYER } from '../engine/constants';
import { getSafeImageUrl } from '../../../utils/cardHelpers';
import sortedTypes from '../../../data/sorted_types.json';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeFieldCard(card) {
  return { card, state: 'active', attachedDon: 0, justDeployed: false };
}

// Colors that appear on One Piece cards
const COLORS = ['Red', 'Green', 'Blue', 'Purple', 'Black', 'Yellow'];
const CATEGORIES = ['Character', 'Event', 'Stage', 'Leader'];

// Keywords that indicate an effect-related log entry
const EFFECT_KEYWORDS = [
  'trigger', 'effect', '登場時', '攻擊時', '啟動主要', '啟動：主要',
  '觸發', '啟動', '發動', '效果', 'on-play', 'on-attack', 'on-block',
  'on-ko', '對方攻擊時', '結束時', '登場',
];

// ─── component ───────────────────────────────────────────────────────────────

export default function StateSimulator({
  gameState, allCards, dispatch, onClose, passiveAi, onTogglePassiveAi,
  standalone = false,
}) {
  const [query, setQuery]             = useState('');
  const [tab, setTab]                 = useState('hand');
  const [targetPlayer, setTargetPlayer] = useState(PLAYER.HUMAN);
  const [colorFilter, setColorFilter]  = useState(null);   // null = all
  const [catFilter, setCatFilter]      = useState(null);   // null = all
  const [packFilter, setPackFilter]    = useState('');     // '' = all
  const [typeFilter, setTypeFilter]    = useState(null);   // null = all
  const [typeQuery, setTypeQuery]      = useState('');
  const [typeOpen, setTypeOpen]        = useState(false);
  const typeBoxRef = useRef(null);
  const [lifeQuery, setLifeQuery]      = useState('');
  const [leaderQuery, setLeaderQuery]  = useState('');

  // Close type dropdown on outside click
  useEffect(() => {
    function handler(e) {
      if (typeBoxRef.current && !typeBoxRef.current.contains(e.target)) setTypeOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── available packs derived from card database ────────────────────────────
  const packGroups = useMemo(() => {
    if (!allCards) return {};
    const packs = [...new Set(allCards.map(c => c.id?.split('-')[0]).filter(Boolean))].sort();
    return {
      'OP':  packs.filter(p => p.startsWith('OP')),
      'ST':  packs.filter(p => p.startsWith('ST')),
      'EB':  packs.filter(p => p.startsWith('EB')),
      'PRB': packs.filter(p => p.startsWith('PRB')),
      'Other': packs.filter(p => !p.startsWith('OP') && !p.startsWith('ST') && !p.startsWith('EB') && !p.startsWith('PRB')),
    };
  }, [allCards]);

  // ── filtered card results for Hand tab ────────────────────────────────────
  const handResults = useMemo(() => {
    if (!allCards) return [];
    const q = query.trim().toLowerCase();
    return allCards.filter(c => {
      if (colorFilter && !c.colors?.some(col => col.toLowerCase() === colorFilter.toLowerCase())) return false;
      if (catFilter  && c.category !== catFilter) return false;
      if (packFilter && !c.id?.startsWith(packFilter)) return false;
      if (typeFilter && !c.types?.includes(typeFilter)) return false;
      if (q && !(c.name?.toLowerCase().includes(q) || c.id?.toLowerCase().includes(q))) return false;
      return true;
    }).slice(0, 40);
  }, [allCards, query, colorFilter, catFilter, packFilter, typeFilter]);

  // ── results for Life trigger injector ────────────────────────────────────
  const lifeResults = useMemo(() => {
    const q = lifeQuery.trim().toLowerCase();
    if (!q || !allCards) return [];
    return allCards
      .filter(c => c.name?.toLowerCase().includes(q) || c.id?.toLowerCase().includes(q))
      .slice(0, 16);
  }, [allCards, lifeQuery]);

  // ── results for Leader hot-swap ───────────────────────────────────────────
  const leaderResults = useMemo(() => {
    const q = leaderQuery.trim().toLowerCase();
    if (!allCards) return [];
    return allCards
      .filter(c => c.category === 'Leader' && (
        !q || c.name?.toLowerCase().includes(q) || c.id?.toLowerCase().includes(q)
      ))
      .slice(0, 20);
  }, [allCards, leaderQuery]);

  // ── effect trace log ──────────────────────────────────────────────────────
  const traceLog = useMemo(() => {
    if (!gameState?.log) return [];
    return [...gameState.log]
      .filter(e => EFFECT_KEYWORDS.some(kw => e.text?.toLowerCase().includes(kw.toLowerCase())))
      .reverse();
  }, [gameState?.log]);

  // ── LOAD_STATE helpers ────────────────────────────────────────────────────
  function patch(patchFn) {
    dispatch({ type: 'LOAD_STATE', state: patchFn(gameState) });
  }

  function patchPlayer(owner, playerPatchFn) {
    patch(s => ({ ...s, [owner]: playerPatchFn(s[owner]) }));
  }

  // ── hand actions ──────────────────────────────────────────────────────────
  function addToHand(card) {
    patchPlayer(targetPlayer, ps => ({ ...ps, hand: [...ps.hand, card] }));
  }

  function addAllToHand() {
    if (!handResults.length) return;
    patchPlayer(targetPlayer, ps => ({ ...ps, hand: [...ps.hand, ...handResults] }));
  }

  function removeFromHand(owner, idx) {
    patchPlayer(owner, ps => ({ ...ps, hand: ps.hand.filter((_, i) => i !== idx) }));
  }

  function clearHand() {
    patchPlayer(targetPlayer, ps => ({ ...ps, hand: [] }));
  }

  // ── leader hot-swap ────────────────────────────────────────────────────────
  function swapLeader(newLeaderCard) {
    patchPlayer(PLAYER.HUMAN, ps => ({
      ...ps,
      leader: { ...ps.leader, card: newLeaderCard },
    }));
  }

  // ── field actions ─────────────────────────────────────────────────────────
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
        const extra = Math.min(count - current, ps.deck.length);
        const newLife = [...ps.lifeArea, ...ps.deck.slice(-extra)];
        return {
          ...ps,
          lifeArea: newLife,
          lifeAreaFaceUp: [...(ps.lifeAreaFaceUp ?? []), ...Array(extra).fill(false)],
          deck: ps.deck.slice(0, -extra),
        };
      } else {
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

  function injectTopLife(card) {
    patchPlayer(PLAYER.HUMAN, ps => ({
      ...ps,
      lifeArea: [...ps.lifeArea, card],
      lifeAreaFaceUp: [...(ps.lifeAreaFaceUp ?? []), false],
    }));
    setLifeQuery('');
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

  // ── presets ───────────────────────────────────────────────────────────────
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
            [PLAYER.HUMAN]: { ...ps, hand: drawn, deck: ps.deck.slice(0, -5) },
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
          const costArea = Array.from({ length: 10 }, (_, i) => ({
            _donId: `sim-don-${i}`, state: 'active',
          }));
          return {
            ...s,
            phase: PHASE.MAIN,
            activePlayer: PLAYER.HUMAN,
            waitingFor: PLAYER.HUMAN,
            battle: null, pendingEffect: null, mulligan: 'done',
            [PLAYER.HUMAN]: {
              ...ps, hand: drawn, deck: ps.deck.slice(0, -5), costArea, donDeck: [],
            },
          };
        });
      },
    },
    { label: 'Low Life (Human 1 life)', apply() { setLife(PLAYER.HUMAN, 1); } },
    { label: 'Low Life (AI 1 life)',    apply() { setLife(PLAYER.AI, 1); } },
    { label: 'Clear Human Hand',        apply() { clearHand(); } },
    { label: 'Clear Human Field',       apply() { clearField(); } },
  ];

  // ── render ────────────────────────────────────────────────────────────────
  const ps = gameState?.[targetPlayer];
  const humanPs = gameState?.[PLAYER.HUMAN];
  const topLifeCard = humanPs?.lifeArea?.[humanPs.lifeArea.length - 1] ?? null;
  const currentLeaderCard = humanPs?.leader?.card ?? null;

  const TABS = [
    { key: 'hand',    label: 'Hand' },
    { key: 'leader',  label: 'Leader' },
    { key: 'field',   label: 'Field' },
    { key: 'life',    label: 'Life' },
    { key: 'phase',   label: 'Phase' },
    { key: 'presets', label: 'Presets' },
    { key: 'trace',   label: 'Trace' },
  ];

  // ── chip helpers ──────────────────────────────────────────────────────────
  function Chip({ label, active, onClick, color }) {
    return (
      <button
        onClick={onClick}
        className={`px-2 py-0.5 rounded-full text-xs font-bold border transition-colors whitespace-nowrap
          ${active
            ? 'bg-purple-600 border-purple-500 text-white'
            : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-white hover:border-slate-500'}`}
        style={active && color ? { backgroundColor: color, borderColor: color } : undefined}
      >
        {label}
      </button>
    );
  }

  // Color → tailwind-friendly hex approximations for the chip pills
  const COLOR_HEX = {
    Red: '#b91c1c', Green: '#15803d', Blue: '#1d4ed8',
    Purple: '#7e22ce', Black: '#1e293b', Yellow: '#a16207',
  };

  return (
    <div
      className={standalone
        ? 'w-full bg-slate-950 flex flex-col'
        : 'fixed bottom-0 left-0 right-0 z-50 bg-slate-950 border-t border-purple-600/50 shadow-2xl'}
      style={{ ...(standalone ? { height: '100vh' } : { maxHeight: '65vh', display: 'flex', flexDirection: 'column' }) }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 bg-purple-900/60 border-b border-purple-700/40 flex-shrink-0">
        <span className="text-purple-300 font-black text-xs uppercase tracking-widest">⚙ State Simulator</span>
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
          <span className="text-slate-500 text-xs hidden sm:block">Redux DevTools ← time-travel in browser ext</span>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none px-1">×</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-4 py-1.5 border-b border-slate-800 flex-shrink-0 overflow-x-auto">
        {TABS.map(t => (
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
            {/* Pack selector */}
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-xs font-bold uppercase flex-shrink-0">Set</span>
              <select
                value={packFilter}
                onChange={e => setPackFilter(e.target.value)}
                className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-purple-500"
              >
                <option value="">All Sets</option>
                {Object.entries(packGroups).map(([group, packs]) =>
                  packs.length > 0 && (
                    <optgroup key={group} label={group}>
                      {packs.map(p => <option key={p} value={p}>{p}</option>)}
                    </optgroup>
                  )
                )}
              </select>
              {packFilter && (
                <button
                  onClick={() => setPackFilter('')}
                  className="text-slate-400 hover:text-white text-xs font-bold px-1"
                  title="Clear set filter"
                >×</button>
              )}
            </div>
            {/* Color chips */}
            <div className="flex gap-1.5 flex-wrap">
              <Chip label="All colors" active={!colorFilter} onClick={() => setColorFilter(null)} />
              {COLORS.map(c => (
                <Chip key={c} label={c} active={colorFilter === c}
                  onClick={() => setColorFilter(colorFilter === c ? null : c)}
                  color={colorFilter === c ? COLOR_HEX[c] : undefined}
                />
              ))}
            </div>
            {/* Category chips */}
            <div className="flex gap-1.5 flex-wrap">
              <Chip label="All types" active={!catFilter} onClick={() => setCatFilter(null)} />
              {CATEGORIES.map(c => (
                <Chip key={c} label={c} active={catFilter === c}
                  onClick={() => setCatFilter(catFilter === c ? null : c)}
                />
              ))}
            </div>
            {/* Type combobox */}
            <div className="flex items-center gap-2" ref={typeBoxRef}>
              <span className="text-slate-400 text-xs font-bold uppercase flex-shrink-0">Type</span>
              {typeFilter ? (
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-purple-600 text-white truncate">
                    {typeFilter}
                  </span>
                  <button
                    onClick={() => { setTypeFilter(null); setTypeQuery(''); }}
                    className="text-slate-400 hover:text-white text-xs font-bold flex-shrink-0"
                    title="Clear type filter"
                  >×</button>
                </div>
              ) : (
                <div className="relative flex-1">
                  <input
                    value={typeQuery}
                    onChange={e => { setTypeQuery(e.target.value); setTypeOpen(true); }}
                    onFocus={() => setTypeOpen(true)}
                    placeholder="Search type…"
                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  />
                  {typeOpen && (
                    <div className="absolute z-10 top-full left-0 right-0 mt-0.5 bg-slate-800 border border-slate-600 rounded shadow-xl max-h-48 overflow-y-auto">
                      {sortedTypes
                        .filter(t => !typeQuery || t.includes(typeQuery))
                        .slice(0, 30)
                        .map(t => (
                          <button key={t}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => { setTypeFilter(t); setTypeQuery(''); setTypeOpen(false); }}
                            className="w-full text-left px-3 py-1.5 text-xs text-slate-200 hover:bg-purple-700/60 transition-colors"
                          >
                            {t}
                          </button>
                        ))
                      }
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* Search input + bulk add */}
            <div className="flex gap-2">
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Filter by name or ID…"
                className="flex-1 bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
              <button
                onClick={addAllToHand}
                disabled={!handResults.length}
                title="Add all shown cards to hand"
                className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-xs font-bold rounded transition-colors whitespace-nowrap"
              >
                Add All ({handResults.length})
              </button>
            </div>
            {/* Results */}
            {handResults.length > 0 && (
              <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
                {handResults.map(card => (
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

        {/* ── LEADER ── */}
        {tab === 'leader' && (
          <div className="space-y-3">
            {/* Current leader */}
            {currentLeaderCard && (
              <div>
                <div className="text-slate-400 text-xs font-bold uppercase mb-1.5">Current Leader</div>
                <div className="flex items-center gap-3 p-2 bg-slate-800 rounded">
                  <img
                    src={getSafeImageUrl(currentLeaderCard.img_url ?? currentLeaderCard.img_full_url)}
                    alt={currentLeaderCard.name}
                    className="w-12 h-16 object-cover rounded border border-purple-600"
                    onError={e => { e.target.style.display = 'none'; }}
                  />
                  <div>
                    <div className="text-white font-bold text-sm">{currentLeaderCard.name}</div>
                    <div className="text-slate-400 text-xs">{currentLeaderCard.id}</div>
                    <div className="text-slate-400 text-xs">Cost {currentLeaderCard.cost} · {currentLeaderCard.power} pw</div>
                  </div>
                </div>
              </div>
            )}
            <div className="text-slate-400 text-xs font-bold uppercase">Swap Leader</div>
            <input
              value={leaderQuery}
              onChange={e => setLeaderQuery(e.target.value)}
              placeholder="Search leader by name or ID…"
              className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
            />
            <div className="text-slate-500 text-xs">
              Swaps the card only — hand, deck, field, and attached DON are preserved.
            </div>
            {leaderResults.length > 0 && (
              <div className="grid grid-cols-2 gap-1.5 max-h-64 overflow-y-auto">
                {leaderResults.map(card => (
                  <button key={card.id}
                    onClick={() => { swapLeader(card); setLeaderQuery(''); }}
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
            {handResults.filter(c => c.category === 'Character').length > 0 && (
              <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
                {handResults.filter(c => c.category === 'Character').map(card => (
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
            {/* Life count buttons (existing) */}
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

            {/* Trigger injector */}
            <div className="border-t border-slate-800 pt-3">
              <div className="text-slate-300 text-xs font-bold uppercase mb-2">Inject Trigger Card (Human Top Life)</div>
              {/* Current top card preview */}
              {topLifeCard ? (
                <div className="flex items-center gap-3 mb-3 p-2 bg-slate-800/60 rounded">
                  <img
                    src={getSafeImageUrl(topLifeCard.img_url ?? topLifeCard.img_full_url)}
                    alt={topLifeCard.name}
                    className="w-10 h-14 object-cover rounded border border-yellow-600"
                    onError={e => { e.target.style.display = 'none'; }}
                  />
                  <div>
                    <div className="text-yellow-400 text-xs font-bold">Next trigger:</div>
                    <div className="text-white text-xs">{topLifeCard.name}</div>
                    <div className="text-slate-400 text-xs">{topLifeCard.id}</div>
                  </div>
                </div>
              ) : (
                <div className="text-slate-500 text-xs mb-3">Life area is empty.</div>
              )}
              <input
                value={lifeQuery}
                onChange={e => setLifeQuery(e.target.value)}
                placeholder="Search card to inject as top life…"
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-yellow-500 mb-2"
              />
              {lifeResults.length > 0 && (
                <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
                  {lifeResults.map(card => (
                    <button key={card.id}
                      onClick={() => injectTopLife(card)}
                      className="flex items-center gap-2 bg-slate-800 hover:bg-yellow-900/40 border border-transparent hover:border-yellow-700 rounded p-2 text-left transition-colors"
                    >
                      <img
                        src={getSafeImageUrl(card.img_url ?? card.img_full_url)}
                        alt={card.name}
                        className="w-8 h-11 object-cover rounded flex-shrink-0"
                        onError={e => { e.target.style.display = 'none'; }}
                      />
                      <div className="min-w-0">
                        <div className="text-white text-xs font-bold truncate">{card.name}</div>
                        <div className="text-slate-400 text-xs">{card.id}</div>
                        {card.trigger && (
                          <div className="text-yellow-400 text-xs font-bold">Trigger</div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
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
              {['REFRESH', 'DRAW', 'DON', 'MAIN', 'END'].map(p => (
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

            {/* DON injection */}
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

            {/* Passive AI toggle */}
            <div className="mt-3 border-t border-slate-800 pt-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-slate-300 text-xs font-bold uppercase">Passive AI</div>
                  <div className="text-slate-500 text-xs mt-0.5">AI immediately ends its turn without playing cards or attacking</div>
                </div>
                <button
                  onClick={onTogglePassiveAi}
                  className={`ml-4 px-4 py-2 rounded-lg text-xs font-black transition-colors flex-shrink-0
                    ${passiveAi
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                      : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}
                >
                  {passiveAi ? 'ON' : 'OFF'}
                </button>
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

        {/* ── TRACE ── */}
        {tab === 'trace' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-slate-400 text-xs font-bold uppercase">
                Effect Trace ({traceLog.length} entries)
              </span>
              <button
                onClick={() => patch(s => ({ ...s, log: [] }))}
                className="text-xs text-red-400 hover:text-red-300"
              >
                Clear Log
              </button>
            </div>
            {traceLog.length === 0 ? (
              <div className="text-slate-500 text-xs">
                No effect entries yet. Play cards with on-play/trigger effects to see them here.
              </div>
            ) : (
              <div className="space-y-1">
                {traceLog.map((entry, i) => (
                  <div key={entry.id ?? i}
                    className={`px-2 py-1.5 rounded text-xs font-mono leading-relaxed
                      ${entry.type === 'battle'  ? 'bg-orange-950/40 text-orange-200' :
                        entry.type === 'damage'  ? 'bg-red-950/40 text-red-200' :
                        entry.type === 'action'  ? 'bg-blue-950/40 text-blue-200' :
                        entry.type === 'phase'   ? 'bg-emerald-950/40 text-emerald-200' :
                        'bg-slate-800/60 text-slate-300'}`}
                  >
                    {entry.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
