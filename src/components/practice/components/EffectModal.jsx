import React, { useState, useEffect } from 'react';
import { getSafeImageUrl } from '../../../utils/cardHelpers';

/**
 * Modal for interactive card effect choices and full-field replacement.
 * Shows replace UI when pendingReplace is set; effect UI when pendingEffect is set.
 */
export default function EffectModal({ pendingEffect, pendingReplace, state, onResolve, onReplace }) {
  const [selected, setSelected] = useState([]);
  const [placeOnTop, setPlaceOnTop] = useState(false);

  const modalType = pendingReplace ? 'replace' : pendingEffect ? 'effect' : null;
  useEffect(() => { setSelected([]); setPlaceOnTop(false); }, [modalType]);

  if (!modalType) return null;

  // ── Replace modal ───────────────────────────────────────────────────────────

  if (modalType === 'replace') {
    const { owner, card } = pendingReplace;
    const chars = state[owner].characterArea;

    function confirmReplace() {
      if (selected.length === 0) return;
      onReplace(selected[0]);
      setSelected([]);
    }

    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm">
        <div className="bg-slate-900 border border-orange-500/40 rounded-t-2xl shadow-2xl w-full max-w-sm overflow-hidden pb-safe">

          <div className="bg-orange-700 px-4 py-2 flex items-center gap-2">
            <span className="text-white font-black text-xs uppercase tracking-widest">↔ Replace</span>
            <span className="text-orange-200 text-xs truncate ml-auto">{card.name}</span>
          </div>

          <div className="px-4 pt-3 pb-1">
            <p className="text-white font-black text-sm">Field Full — Choose a Character to Replace</p>
            <p className="text-slate-400 text-xs mt-0.5">Selected character will be sent to trash</p>
          </div>

          <div className="px-4 pb-3 overflow-y-auto max-h-56">
            <div className="flex flex-wrap gap-2 pt-2">
              {chars.map((fc, i) => {
                const isSelected = selected.includes(i);
                return (
                  <button
                    key={i}
                    onClick={() => setSelected([i])}
                    className={`relative flex-shrink-0 rounded-xl border-2 transition-all active:scale-95
                      ${isSelected
                        ? 'border-orange-400 shadow-lg shadow-orange-500/40 scale-105'
                        : 'border-slate-600 opacity-80'
                      }`}
                  >
                    <img
                      src={getSafeImageUrl(fc.card)}
                      alt={fc.card.name}
                      className="w-16 rounded-xl object-cover"
                      style={{ height: '5.5rem' }}
                      onError={e => { e.target.src = '/images/card_back.png'; }}
                    />
                    <div className="absolute bottom-1 left-0 right-0 text-center">
                      <span className="bg-slate-900/80 text-white text-[8px] font-bold px-1 rounded">
                        {fc.card.power?.toLocaleString() ?? ''}
                      </span>
                    </div>
                    {isSelected && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-orange-500/30">
                        <span className="text-white text-2xl font-black">✕</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex gap-2 px-4 pb-4 pt-2 border-t border-slate-700">
            <button
              onClick={confirmReplace}
              disabled={selected.length === 0}
              className={`flex-1 py-3 font-black text-sm rounded-xl active:scale-95 transition-all
                ${selected.length > 0
                  ? 'bg-orange-600 hover:bg-orange-500 text-white'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                }`}
            >
              Confirm Replace
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Effect modal ────────────────────────────────────────────────────────────

  const { sourceCard, choices } = pendingEffect;

  let items = [];
  let title = '';
  let subtitle = '';
  let maxSelect = 1;
  let confirmLabel = 'Confirm';
  let canSkip = false;

  // ── Confirmation modal (optional cost) ─────────────────────────────────────
  if (choices.type === 'CONFIRM_OPTIONAL_ACTIVATION') {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm">
        <div className="bg-slate-900 border border-blue-500/40 rounded-t-2xl shadow-2xl w-full max-w-sm overflow-hidden pb-safe">
          <div className="bg-blue-700 px-4 py-2 flex items-center gap-2">
            <span className="text-white font-black text-xs uppercase tracking-widest">✦ Effect</span>
            <span className="text-blue-200 text-xs truncate ml-auto">{sourceCard?.name}</span>
          </div>
          <div className="px-4 pt-4 pb-2">
            <p className="text-white font-black text-sm">Activate Optional Effect?</p>
            <p className="text-slate-400 text-xs mt-1">
              <span className="text-slate-300 font-semibold">Cost: </span>
              {choices.costDescription}
            </p>
          </div>
          <div className="flex gap-2 px-4 pb-4 pt-3 border-t border-slate-700">
            <button
              onClick={() => { onResolve([]); }}
              className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm rounded-xl active:scale-95 transition-all"
            >
              Skip
            </button>
            <button
              onClick={() => { onResolve([1]); }}
              className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white font-black text-sm rounded-xl active:scale-95 transition-all"
            >
              Activate
            </button>
          </div>
        </div>
      </div>
    );
  }

  switch (choices.type) {

    case 'CHOOSE_KO_TARGET':
      title = 'Choose KO Target';
      subtitle = `KO up to ${pendingEffect.action.count ?? 1} card(s)`;
      maxSelect = pendingEffect.action.count ?? 1;
      canSkip = true;
      items = choices.indices.map(i => ({
        key: i,
        card: state[choices.targetOwner].characterArea[i].card,
        label: `${state[choices.targetOwner].characterArea[i].card.name} (${state[choices.targetOwner].characterArea[i].card.power ?? '?'})`,
      }));
      break;

    case 'CHOOSE_RETURN_HAND_TARGET':
      title = 'Choose — Return to Hand';
      subtitle = `Return up to ${choices.max} card(s) to owner's hand`;
      maxSelect = choices.max;
      canSkip = true;
      items = choices.targets.map((t, i) => {
        const fc = state[t.owner].characterArea[t.charIndex];
        return {
          key: i,
          card: fc.card,
          label: `${fc.card.name} (Cost ${fc.card.cost ?? 0})${t.owner !== pendingEffect.owner ? ' [Opp]' : ''}`,
        };
      });
      break;

    case 'CHOOSE_ADD_TO_HAND_TARGET':
      title = 'Add to Hand';
      subtitle = `Choose up to ${choices.max} card(s) to add to hand`;
      maxSelect = choices.max;
      canSkip = true;
      items = choices.zone === 'trash'
        ? choices.indices.map(i => ({
            key: i,
            card: state[choices.sourceOwner].trash[i],
            label: `${state[choices.sourceOwner].trash[i].name} (Cost ${state[choices.sourceOwner].trash[i].cost ?? 0})`,
          }))
        : choices.targets.map((t, i) => {
            const fc = state[t.owner].characterArea[t.charIndex];
            return {
              key: i,
              card: fc.card,
              label: `${fc.card.name} (Cost ${fc.card.cost ?? 0})`,
            };
          });
      break;

    case 'CHOOSE_BOTTOM_DECK_TARGET':
      title = choices.fromTrash ? 'Choose Cards — Bottom Deck (from Trash)' : 'Choose Target — Bottom Deck';
      subtitle = `Place up to ${choices.max ?? 1} card(s) at the bottom of the deck`;
      maxSelect = choices.max ?? 1;
      canSkip = true;
      items = choices.fromTrash
        ? choices.indices.map(i => ({
            key: i,
            card: state[choices.targetOwner].trash[i],
            label: `${state[choices.targetOwner].trash[i].name} (Cost ${state[choices.targetOwner].trash[i].cost ?? 0})`,
          }))
        : choices.indices.map(i => ({
            key: i,
            card: state[choices.targetOwner].characterArea[i].card,
            label: `${state[choices.targetOwner].characterArea[i].card.name} (${state[choices.targetOwner].characterArea[i].card.power ?? '?'})`,
          }));
      break;

    case 'CHOOSE_REST_TARGET':
      title = 'Choose Target to Rest';
      subtitle = `Rest up to ${choices.max} card(s)`;
      maxSelect = choices.max;
      canSkip = true;
      items = choices.indices.map(i => ({
        key: i,
        card: state[choices.targetOwner].characterArea[i].card,
        label: state[choices.targetOwner].characterArea[i].card.name,
      }));
      break;

    case 'CHOOSE_UNREST_TARGET':
      title = 'Choose Target to Activate';
      subtitle = `Activate up to ${choices.max} rested card(s)`;
      maxSelect = choices.max;
      canSkip = true;
      items = choices.targets.map((t, i) => {
        const tps = state[choices.targetOwner];
        const card = t.zone === 'leader' ? tps.leader.card : tps.characterArea[t.index].card;
        const tag  = t.zone === 'leader' ? ' [Leader]' : '';
        return { key: i, card, label: `${card.name}${tag}` };
      });
      break;

    case 'CHOOSE_REFRESH_LOCK_TARGET':
      title = 'Choose Refresh Lock Target';
      subtitle = `Choose up to ${choices.max} rested opponent character(s) — they cannot refresh next turn`;
      maxSelect = choices.max;
      canSkip = true;
      items = choices.indices.map(i => ({
        key: i,
        card: state[choices.targetOwner].characterArea[i].card,
        label: `${state[choices.targetOwner].characterArea[i].card.name} (Cost ${state[choices.targetOwner].characterArea[i].card.cost ?? 0})`,
      }));
      break;

    case 'CHOOSE_POWER_TARGET': {
      const pmPs = state[choices.targetOwner];
      title = 'Choose Power Target';
      subtitle = `Apply ${pendingEffect.action.delta > 0 ? '+' : ''}${pendingEffect.action.delta} power`;
      maxSelect = 1;
      canSkip = true;
      items = choices.targets.map((t, i) => {
        const card = t.zone === 'leader' ? pmPs.leader.card : pmPs.characterArea[t.index].card;
        return { key: i, card, label: `${card.name} (${card.power ?? '?'})` };
      });
      break;
    }

    case 'CHOOSE_COST_TARGET':
      title = 'Choose Cost Target';
      subtitle = `Apply cost ${pendingEffect.action.delta > 0 ? '+' : ''}${pendingEffect.action.delta}`;
      maxSelect = 1;
      canSkip = true;
      items = choices.indices.map(i => ({
        key: i,
        card: state[choices.targetOwner].characterArea[i].card,
        label: `${state[choices.targetOwner].characterArea[i].card.name} (Cost ${state[choices.targetOwner].characterArea[i].card.cost ?? 0})`,
      }));
      break;

    case 'CHOOSE_DEPLOY_FROM_HAND':
      title = 'Deploy from Hand';
      subtitle = `Choose up to ${choices.max} card(s) to deploy for free`;
      maxSelect = choices.max;
      canSkip = true;
      items = choices.indices.map(i => ({
        key: i,
        card: state[choices.sourceOwner].hand[i],
        label: `${state[choices.sourceOwner].hand[i].name} (Cost ${state[choices.sourceOwner].hand[i].cost ?? 0})`,
      }));
      break;

    case 'CHOOSE_DEPLOY_FROM_TRASH':
      title = 'Deploy from Trash';
      subtitle = `Choose up to ${choices.max} card(s) to deploy from trash`;
      maxSelect = choices.max;
      canSkip = true;
      items = choices.indices.map(i => ({
        key: i,
        card: state[choices.sourceOwner].trash[i],
        label: `${state[choices.sourceOwner].trash[i].name} (Cost ${state[choices.sourceOwner].trash[i].cost ?? 0})`,
      }));
      break;

    case 'CHOOSE_DISCARD':
      title = 'Choose Cards to Discard';
      subtitle = `Discard exactly ${choices.count} card(s)`;
      maxSelect = choices.count;
      canSkip = false;
      confirmLabel = `Discard ${choices.count}`;
      items = choices.indices.map(i => ({
        key: i,
        card: state[pendingEffect.owner].hand[i],
        label: `${state[pendingEffect.owner].hand[i].name}`,
      }));
      break;

    case 'CHOOSE_HAND_TO_DECK':
      title = 'Place Hand Cards on Deck';
      subtitle = `Choose ${choices.max} card(s) to place on top or bottom of your deck`;
      maxSelect = choices.max;
      canSkip = false;
      confirmLabel = `Place ${choices.max}`;
      items = choices.indices.map(i => ({
        key: i,
        card: state[pendingEffect.owner].hand[i],
        label: `${state[pendingEffect.owner].hand[i].name}`,
      }));
      break;

    case 'CHOOSE_DISCARD_FREE':
      title = 'Discard for Power Boost';
      subtitle = `Discard any Event/Stage cards (+1000 power each). Select 0 to skip.`;
      maxSelect = choices.indices.length;
      canSkip = true;
      confirmLabel = selected.length ? `Discard ${selected.length}` : 'Skip';
      items = choices.indices.map(i => ({
        key: i,
        card: state[pendingEffect.owner].hand[i],
        label: `${state[pendingEffect.owner].hand[i].name}`,
      }));
      break;

    case 'CHOOSE_FREE_EVENT':
      title = 'Play Event for Free';
      subtitle = `Choose up to ${choices.max} Event card(s) to activate without paying cost`;
      maxSelect = choices.max;
      canSkip = true;
      confirmLabel = selected.length ? `Activate ${selected.length}` : 'Skip';
      items = choices.indices.map(i => ({
        key: i,
        card: state[pendingEffect.owner].hand[i],
        label: `${state[pendingEffect.owner].hand[i].name} (Cost ${state[pendingEffect.owner].hand[i].cost ?? 0})`,
      }));
      break;

    case 'SEARCH_PICK': {
      const hasFilter = choices.eligibleIndices && choices.eligibleIndices.length < choices.revealed.length;
      title = 'Search — Choose Cards';
      subtitle = hasFilter
        ? `Take up to ${choices.take} matching card(s) — others go back to the bottom`
        : `Take up to ${choices.take} card(s) — others go back to the bottom`;
      maxSelect = choices.take;
      canSkip = false;
      confirmLabel = `Take ${selected.length}`;
      items = choices.revealed.map((card, i) => ({
        key: i,
        card,
        label: `${card.name} (Cost ${card.cost ?? 0})`,
        eligible: !choices.eligibleIndices || choices.eligibleIndices.includes(i),
      }));
      break;
    }

    case 'CHOOSE_HAND_TO_LIFE':
      title = 'Move to Life Area';
      subtitle = `Choose ${choices.count} card(s) to place on top of your life`;
      maxSelect = choices.count;
      canSkip = false;
      confirmLabel = 'Move to Life';
      items = choices.indices.map(i => ({
        key: i,
        card: state[pendingEffect.owner].hand[i],
        label: state[pendingEffect.owner].hand[i].name,
        eligible: true,
      }));
      break;

    case 'CHOOSE_ADD_TO_LIFE': {
      const targetDesc = choices.targetOwner === 'opponent' ? "opponent's" : 'your';
      const posDesc    = choices.positionChoice ? '' : choices.position === 'bottom' ? ' (bottom)' : ' (top)';
      title    = 'Move to Life Area';
      subtitle = `Choose ${choices.count} card(s) to place in ${targetDesc} life${posDesc}`;
      maxSelect   = choices.count;
      canSkip     = false;
      confirmLabel = 'Move to Life';
      items = choices.targets.map((t, i) => {
        let card, label;
        if (choices.sourceZone === 'hand') {
          card  = state[t.ownerKey].hand[t.index];
          label = `${card.name} (Cost ${card.cost ?? 0})`;
        } else {
          const fc = state[t.ownerKey].characterArea[t.index];
          card  = fc.card;
          const oppLabel = t.ownerKey !== pendingEffect.owner ? ' [Opp]' : '';
          label = `${card.name} (${card.power?.toLocaleString() ?? '?'})${oppLabel}`;
        }
        return { key: i, card, label, eligible: true };
      });
      break;
    }

    case 'CHOOSE_DON_UNREST': {
      title = 'Activate DON!!';
      subtitle = `Choose up to ${choices.max} rested DON!! to set active`;
      maxSelect = choices.max;
      canSkip = true;
      confirmLabel = selected.length ? `Activate ${selected.length}` : 'Skip';
      items = choices.options.map((opt, i) => ({
        key: i,
        card: null,
        donLabel: 'Rested',
        sourceLabel: 'Cost Area',
        eligible: true,
      }));
      break;
    }

    case 'CHOOSE_DON_RETURN': {
      title = 'Return DON!!';
      subtitle = `Choose ${choices.count} DON!! to return to DON!! deck`;
      maxSelect = choices.count;
      canSkip = false;
      confirmLabel = `Return ${choices.count} DON!!`;
      const ps = state[pendingEffect.owner];
      items = choices.options.map((opt, i) => {
        let donLabel, sourceLabel;
        if (opt.source === 'cost') {
          donLabel    = opt.state === 'active' ? 'Active' : 'Rested';
          sourceLabel = 'Cost Area';
        } else if (opt.source === 'leader') {
          donLabel    = 'Attached';
          sourceLabel = ps.leader.card?.name ?? 'Leader';
        } else {
          donLabel    = 'Attached';
          sourceLabel = ps.characterArea[opt.charIndex]?.card?.name ?? 'Character';
        }
        return { key: i, card: null, donLabel, sourceLabel, eligible: true };
      });
      break;
    }

    case 'SEARCH_ORDER':
      title = choices.canPlaceOnTop ? 'Arrange Cards' : 'Arrange Bottom Cards';
      subtitle = 'Tap in order — 1 = drawn first from the placed group';
      maxSelect = choices.remaining.length;
      canSkip = false;
      confirmLabel = 'Confirm Order';
      items = choices.remaining.map((card, i) => ({
        key: i,
        card,
        label: card.name,
        eligible: true,
      }));
      break;

    case 'CHOOSE_DON_ATTACH_TARGET': {
      title = 'Attach DON!!';
      subtitle = `Choose a target to attach ${choices.count} DON!!${choices.donState === 'rest' ? ' (rested)' : ''}`;
      maxSelect = 1;
      canSkip = true;
      const aps = state[pendingEffect.owner];
      items = choices.targets.map((t, i) => {
        const card = t.zone === 'leader' ? aps.leader.card : aps.characterArea[t.index].card;
        return { key: i, card, label: card.name, eligible: true };
      });
      break;
    }

    default:
      return null;
  }

  function toggle(key) {
    const item = items.find(it => it.key === key);
    if (item?.eligible === false) return;
    if (choices.type === 'SEARCH_ORDER') {
      // Append-only ordering: tap to assign position, tap again to remove
      setSelected(prev =>
        prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
      );
      return;
    }
    setSelected(prev => {
      if (prev.includes(key)) return prev.filter(k => k !== key);
      if (prev.length >= maxSelect) return maxSelect === 1 ? [key] : prev;
      return [...prev, key];
    });
  }

  function confirm() {
    let result = choices.type === 'SEARCH_ORDER' && choices.canPlaceOnTop && placeOnTop
      ? [...selected, -1]   // -1 sentinel = place on top of deck
      : [...selected];
    if (choices.type === 'CHOOSE_ADD_TO_LIFE' && choices.positionChoice) {
      // Append position sentinel: -1 = life top, -2 = life bottom
      result = [...selected, placeOnTop ? -1 : -2];
    }
    onResolve(result);
    setSelected([]);
    setPlaceOnTop(false);
  }

  function skip() {
    onResolve([]);
    setSelected([]);
  }

  const canConfirm = choices.type === 'CHOOSE_DISCARD'
    ? selected.length === choices.count
    : choices.type === 'SEARCH_PICK'
      ? true   // allowed to take 0 if nothing eligible matches
      : choices.type === 'SEARCH_ORDER'
        ? selected.length === choices.remaining.length  // must order every card
        : choices.type === 'CHOOSE_HAND_TO_DECK'
          ? selected.length === choices.max
          : choices.type === 'CHOOSE_DON_RETURN'
            ? selected.length === choices.count
            : selected.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-slate-900 border border-blue-500/40 rounded-t-2xl shadow-2xl w-full max-w-sm overflow-hidden pb-safe">

        <div className="bg-blue-700 px-4 py-2 flex items-center gap-2">
          <span className="text-white font-black text-xs uppercase tracking-widest">✦ Effect</span>
          <span className="text-blue-200 text-xs truncate ml-auto">{sourceCard?.name}</span>
        </div>

        <div className="px-4 pt-3 pb-1">
          <p className="text-white font-black text-sm">{title}</p>
          <p className="text-slate-400 text-xs mt-0.5">{subtitle}</p>
        </div>

        {choices.type === 'SEARCH_ORDER' && choices.canPlaceOnTop && (
          <div className="flex gap-2 px-4 pb-2">
            <button
              onClick={() => setPlaceOnTop(false)}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all
                ${!placeOnTop ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}
            >
              Deck Bottom
            </button>
            <button
              onClick={() => setPlaceOnTop(true)}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all
                ${placeOnTop ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}
            >
              Deck Top
            </button>
          </div>
        )}

        {choices.type === 'CHOOSE_ADD_TO_LIFE' && choices.positionChoice && (
          <div className="flex gap-2 px-4 pb-2">
            <button
              onClick={() => setPlaceOnTop(true)}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all
                ${placeOnTop ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}
            >
              Life Top
            </button>
            <button
              onClick={() => setPlaceOnTop(false)}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all
                ${!placeOnTop ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}
            >
              Life Bottom
            </button>
          </div>
        )}

        <div className="px-4 pb-3 overflow-y-auto max-h-56">
          <div className="flex flex-wrap gap-2 pt-2">
            {items.map(({ key, card, eligible, donLabel, sourceLabel }) => {
              const isSelected   = selected.includes(key);
              const isIneligible = eligible === false;
              return (
                <button
                  key={key}
                  onClick={() => toggle(key)}
                  disabled={isIneligible}
                  className={`relative flex-shrink-0 rounded-xl border-2 transition-all active:scale-95
                    ${isIneligible
                      ? 'border-slate-700 opacity-30 cursor-not-allowed'
                      : isSelected
                        ? 'border-blue-400 shadow-lg shadow-blue-500/40 scale-105'
                        : 'border-slate-600 opacity-80'
                    }`}
                >
                  {card ? (
                    <>
                      <img
                        src={getSafeImageUrl(card)}
                        alt={card.name}
                        className="w-16 rounded-xl object-cover"
                        style={{ height: '5.5rem' }}
                        onError={e => { e.target.src = '/images/card_back.png'; }}
                      />
                      <div className="absolute bottom-1 left-0 right-0 text-center">
                        <span className="bg-slate-900/80 text-white text-[8px] font-bold px-1 rounded truncate">
                          {card.cost ?? ''}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div
                      className="w-16 rounded-xl bg-yellow-700 flex flex-col items-center justify-center gap-0.5 px-1"
                      style={{ height: '5.5rem' }}
                    >
                      <span className="text-yellow-300 font-black text-[10px]">DON!!</span>
                      <span className="text-white text-[9px] font-bold text-center leading-tight">{donLabel}</span>
                      <span className="text-yellow-200 text-[8px] text-center leading-tight w-full truncate">{sourceLabel}</span>
                    </div>
                  )}
                  {isSelected && choices.type === 'SEARCH_ORDER' && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-blue-500/30">
                      <span className="bg-blue-600 text-white text-sm font-black w-7 h-7 rounded-full flex items-center justify-center">
                        {selected.indexOf(key) + 1}
                      </span>
                    </div>
                  )}
                  {isSelected && choices.type !== 'SEARCH_ORDER' && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-blue-500/20">
                      <span className="text-white text-lg font-black">✓</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex gap-2 px-4 pb-4 pt-2 border-t border-slate-700">
          {canSkip && (
            <button
              onClick={skip}
              className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm rounded-xl active:scale-95 transition-all"
            >
              Skip
            </button>
          )}
          <button
            onClick={confirm}
            disabled={!canConfirm}
            className={`flex-1 py-3 font-black text-sm rounded-xl active:scale-95 transition-all
              ${canConfirm
                ? 'bg-blue-600 hover:bg-blue-500 text-white'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
              }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
