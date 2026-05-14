import React, { useState, useEffect } from 'react';
import { getSafeImageUrl } from '../../../utils/cardHelpers';
import DraggablePanel from './DraggablePanel';

function buildChoiceConfig(choices, pendingEffect, state) {
  const { type } = choices;

  if (type === 'CHOOSE_KO_TARGET') return {
    title: 'Choose KO Target',
    subtitle: `KO up to ${pendingEffect.action.count ?? 1} card(s)`,
    maxSelect: pendingEffect.action.count ?? 1,
    canSkip: true,
    items: choices.indices.map(i => ({
      key: i,
      card: state[choices.targetOwner].characterArea[i].card,
      label: `${state[choices.targetOwner].characterArea[i].card.name} (${state[choices.targetOwner].characterArea[i].card.power ?? '?'})`,
    })),
  };

  if (type === 'CHOOSE_REDIRECT_ATTACK_TARGET') {
    const rps = state[pendingEffect.owner];
    return {
      title: 'Redirect Attack',
      subtitle: 'Choose a new attack target',
      maxSelect: 1,
      items: choices.targets.map((t, i) => {
        if (t.zone === 'leader') return { key: i, card: rps.leader.card, label: `${rps.leader.card.name} [Leader]` };
        return { key: i, card: rps.characterArea[t.index].card, label: rps.characterArea[t.index].card.name };
      }),
    };
  }

  if (type === 'CHOOSE_RETURN_HAND_TARGET') return {
    title: 'Choose — Return to Hand',
    subtitle: `Return up to ${choices.max} card(s) to owner's hand`,
    maxSelect: choices.max,
    canSkip: true,
    items: choices.targets.map((t, i) => {
      const fc = state[t.owner].characterArea[t.charIndex];
      return {
        key: i,
        card: fc.card,
        label: `${fc.card.name} (Cost ${fc.card.cost ?? 0})${t.owner !== pendingEffect.owner ? ' [Opp]' : ''}`,
      };
    }),
  };

  if (type === 'CHOOSE_ADD_TO_HAND_TARGET') return {
    title: 'Add to Hand',
    subtitle: `Choose up to ${choices.max} card(s) to add to hand`,
    maxSelect: choices.max,
    canSkip: true,
    items: choices.zone === 'trash'
      ? choices.indices.map(i => ({
          key: i,
          card: state[choices.sourceOwner].trash[i],
          label: `${state[choices.sourceOwner].trash[i].name} (Cost ${state[choices.sourceOwner].trash[i].cost ?? 0})`,
        }))
      : choices.targets.map((t, i) => {
          const fc = state[t.owner].characterArea[t.charIndex];
          return { key: i, card: fc.card, label: `${fc.card.name} (Cost ${fc.card.cost ?? 0})` };
        }),
  };

  if (type === 'CHOOSE_BOTTOM_DECK_TARGET') return {
    title: choices.fromTrash ? 'Choose Cards — Bottom Deck (from Trash)' : 'Choose Target — Bottom Deck',
    subtitle: choices.orderMode
      ? 'Tap to deselect / reselect — 1 = drawn first from this group (pre-assigned order shown)'
      : `Place up to ${choices.max ?? 1} card(s) at the bottom of the deck`,
    maxSelect: choices.max ?? 1,
    canSkip: true,
    items: choices.fromTrash
      ? choices.indices.map(i => ({
          key: i,
          card: state[choices.targetOwner].trash[i],
          label: `${state[choices.targetOwner].trash[i].name} (Cost ${state[choices.targetOwner].trash[i].cost ?? 0})`,
        }))
      : choices.indices.map(i => ({
          key: i,
          card: state[choices.targetOwner].characterArea[i].card,
          label: `${state[choices.targetOwner].characterArea[i].card.name} (${state[choices.targetOwner].characterArea[i].card.power ?? '?'})`,
        })),
  };

  if (type === 'CHOOSE_REST_TARGET') {
    const tps = state[choices.targetOwner];
    return {
      title: 'Choose Target to Rest',
      subtitle: choices.optional ? 'Rest any number of DON!! (optional)' : `Rest ${choices.max} card(s) as cost`,
      maxSelect: choices.max,
      canSkip: !!choices.optional,
      canCancel: !!choices.cancelable,
      items: choices.targets
        ? choices.targets.map((t, i) => {
            if (t.zone === 'leader')    return { key: i, card: tps.leader.card,                 label: `${tps.leader.card.name} [Leader]` };
            if (t.zone === 'character') return { key: i, card: tps.characterArea[t.index].card, label: tps.characterArea[t.index].card.name };
            if (t.zone === 'stage')     return { key: i, card: tps.stageArea.card,               label: `${tps.stageArea.card.name} [Stage]` };
            return { key: i, card: null, label: 'DON!!' };
          })
        : choices.indices.map(i => ({
            key: i,
            card: tps.characterArea[i].card,
            label: tps.characterArea[i].card.name,
          })),
    };
  }

  if (type === 'CHOOSE_UNREST_TARGET') return {
    title: 'Choose Target to Activate',
    subtitle: `Activate up to ${choices.max} rested card(s)`,
    maxSelect: choices.max,
    canSkip: true,
    items: choices.targets.map((t, i) => {
      const tps = state[choices.targetOwner];
      const card = t.zone === 'leader' ? tps.leader.card : tps.characterArea[t.index].card;
      return { key: i, card, label: `${card.name}${t.zone === 'leader' ? ' [Leader]' : ''}` };
    }),
  };

  if (type === 'CHOOSE_REFRESH_LOCK_TARGET') return {
    title: 'Choose Refresh Lock Target',
    subtitle: `Choose up to ${choices.max} rested opponent leader/character(s) — they cannot refresh next turn`,
    maxSelect: choices.max,
    canSkip: true,
    items: choices.indices.map(i => {
      const fc = i === -1 ? state[choices.targetOwner].leader : state[choices.targetOwner].characterArea[i];
      return { key: i, card: fc.card, label: `${fc.card.name} (${i === -1 ? 'Leader' : `Cost ${fc.card.cost ?? 0}`})` };
    }),
  };

  if (type === 'CHOOSE_PREVENT_REST_TARGET') return {
    title: 'Choose Prevent Rest Target',
    subtitle: `Choose up to ${choices.max} opponent character(s) — they cannot be rested until end of their next turn`,
    maxSelect: choices.max,
    canSkip: true,
    items: choices.indices.map(i => ({
      key: i,
      card: state[choices.targetOwner].characterArea[i].card,
      label: `${state[choices.targetOwner].characterArea[i].card.name} (Cost ${state[choices.targetOwner].characterArea[i].card.cost ?? 0})`,
    })),
  };

  if (type === 'CHOOSE_ATTACK_LOCK_TARGET') return {
    title: 'Choose Attack Lock Target',
    subtitle: `Choose up to ${choices.max} opponent character(s) — they cannot attack until end of their next turn`,
    maxSelect: choices.max,
    canSkip: true,
    items: choices.indices.map(i => ({
      key: i,
      card: state[choices.targetOwner].characterArea[i].card,
      label: `${state[choices.targetOwner].characterArea[i].card.name} (Cost ${state[choices.targetOwner].characterArea[i].card.cost ?? 0})`,
    })),
  };

  if (type === 'CHOOSE_POWER_TARGET') {
    const pmPs = state[choices.targetOwner];
    const pmDelta = pendingEffect.action.totalDelta ?? pendingEffect.action.delta;
    return {
      title: 'Choose Power Target',
      subtitle: `Apply ${pmDelta > 0 ? '+' : ''}${pmDelta} power`,
      maxSelect: 1,
      canSkip: true,
      items: choices.targets.map((t, i) => {
        const card = t.zone === 'leader' ? pmPs.leader.card : pmPs.characterArea[t.index].card;
        return { key: i, card, label: `${card.name} (${card.power ?? '?'})` };
      }),
    };
  }

  if (type === 'CHOOSE_COST_TARGET') return {
    title: 'Choose Cost Target',
    subtitle: `Apply cost ${pendingEffect.action.delta > 0 ? '+' : ''}${pendingEffect.action.delta}`,
    maxSelect: 1,
    canSkip: true,
    items: choices.indices.map(i => ({
      key: i,
      card: state[choices.targetOwner].characterArea[i].card,
      label: `${state[choices.targetOwner].characterArea[i].card.name} (Cost ${state[choices.targetOwner].characterArea[i].card.cost ?? 0})`,
    })),
  };

  if (type === 'CHOOSE_DEPLOY_FROM_HAND') return {
    title: 'Deploy from Hand',
    subtitle: `Choose up to ${choices.max} card(s) to deploy for free`,
    maxSelect: choices.max,
    canSkip: true,
    items: choices.indices.map(i => ({
      key: i,
      card: state[choices.sourceOwner].hand[i],
      label: `${state[choices.sourceOwner].hand[i].name} (Cost ${state[choices.sourceOwner].hand[i].cost ?? 0})`,
    })),
  };

  if (type === 'CHOOSE_DEPLOY_FROM_TRASH') return {
    title: 'Deploy from Trash',
    subtitle: choices.uniqueName
      ? `Choose up to ${choices.max} card(s) to deploy from trash (each must have a different name)`
      : `Choose up to ${choices.max} card(s) to deploy from trash`,
    maxSelect: choices.max,
    canSkip: true,
    items: choices.indices.map(i => ({
      key: i,
      card: state[choices.sourceOwner].trash[i],
      label: `${state[choices.sourceOwner].trash[i].name} (Cost ${state[choices.sourceOwner].trash[i].cost ?? 0})`,
    })),
  };

  if (type === 'CHOOSE_FIELD_FOR_LIFE') return {
    title: 'Choose — Place into Life',
    subtitle: `Choose up to ${choices.max} character(s) to place face-up into life area`,
    maxSelect: choices.max,
    canSkip: true,
    items: choices.indices.map(i => ({
      key: i,
      card: state[pendingEffect.owner].characterArea[i].card,
      label: `${state[pendingEffect.owner].characterArea[i].card.name} (Cost ${state[pendingEffect.owner].characterArea[i].card.cost ?? 0})`,
    })),
  };

  if (type === 'CHOOSE_TRASH_FOR_LIFE_OR_FIELD') return {
    title: 'Choose Card from Trash',
    subtitle: `Choose up to ${choices.max} card(s) to add face-up to life top or deploy`,
    maxSelect: choices.max,
    canSkip: true,
    items: choices.indices.map(i => ({
      key: i,
      card: state[choices.sourceOwner].trash[i],
      label: `${state[choices.sourceOwner].trash[i].name} (Cost ${state[choices.sourceOwner].trash[i].cost ?? 0})`,
    })),
  };

  if (type === 'CHOOSE_DISCARD') return {
    title: 'Choose Cards to Discard',
    subtitle: `Discard exactly ${choices.count} card(s)`,
    maxSelect: choices.count,
    confirmLabel: `Discard ${choices.count}`,
    items: choices.indices.map(i => ({
      key: i,
      card: state[pendingEffect.owner].hand[i],
      label: state[pendingEffect.owner].hand[i].name,
    })),
  };

  if (type === 'CHOOSE_REVEAL_CARDS') return {
    title: 'Reveal Cards',
    subtitle: `Reveal exactly ${choices.count} card(s) to the opponent (they stay in your hand)`,
    maxSelect: choices.count,
    confirmLabel: `Reveal ${choices.count}`,
    items: choices.indices.map(i => ({
      key: i,
      card: state[pendingEffect.owner].hand[i],
      label: state[pendingEffect.owner].hand[i].name,
    })),
  };

  if (type === 'CHOOSE_HAND_TO_DECK') return {
    title: 'Place Hand Cards on Deck',
    subtitle: `Choose ${choices.max} card(s) to place on top or bottom of your deck`,
    maxSelect: choices.max,
    confirmLabel: `Place ${choices.max}`,
    items: choices.indices.map(i => ({
      key: i,
      card: state[pendingEffect.owner].hand[i],
      label: state[pendingEffect.owner].hand[i].name,
    })),
  };

  if (type === 'CHOOSE_DISCARD_FREE') return {
    title: 'Discard for Power Boost',
    subtitle: 'Discard any Event/Stage cards (+1000 power each). Select 0 to skip.',
    maxSelect: choices.indices.length,
    canSkip: true,
    items: choices.indices.map(i => ({
      key: i,
      card: state[pendingEffect.owner].hand[i],
      label: state[pendingEffect.owner].hand[i].name,
    })),
  };

  if (type === 'CHOOSE_FREE_EVENT') return {
    title: 'Play Event for Free',
    subtitle: `Choose up to ${choices.max} Event card(s) to activate without paying cost`,
    maxSelect: choices.max,
    canSkip: true,
    items: choices.indices.map(i => ({
      key: i,
      card: state[pendingEffect.owner].hand[i],
      label: `${state[pendingEffect.owner].hand[i].name} (Cost ${state[pendingEffect.owner].hand[i].cost ?? 0})`,
    })),
  };

  if (type === 'SEARCH_PICK') {
    const hasFilter = choices.eligibleIndices && choices.eligibleIndices.length < choices.revealed.length;
    return {
      title: 'Search — Choose Cards',
      subtitle: hasFilter
        ? `Take up to ${choices.take} matching card(s) — others go back to the bottom`
        : `Take up to ${choices.take} card(s) — others go back to the bottom`,
      maxSelect: choices.take,
      items: choices.revealed.map((card, i) => ({
        key: i,
        card,
        label: `${card.name} (Cost ${card.cost ?? 0})`,
        eligible: !choices.eligibleIndices || choices.eligibleIndices.includes(i),
      })),
    };
  }

  if (type === 'CHOOSE_HAND_TO_LIFE') return {
    title: 'Move to Life Area',
    subtitle: `Choose ${choices.count} card(s) to place on top of your life`,
    maxSelect: choices.count,
    confirmLabel: 'Move to Life',
    items: choices.indices.map(i => ({
      key: i,
      card: state[pendingEffect.owner].hand[i],
      label: state[pendingEffect.owner].hand[i].name,
      eligible: true,
    })),
  };

  if (type === 'CHOOSE_ADD_TO_LIFE') {
    const targetDesc = choices.targetOwner === 'opponent' ? "opponent's" : 'your';
    const posDesc    = choices.positionChoice ? '' : choices.position === 'bottom' ? ' (bottom)' : ' (top)';
    return {
      title: 'Move to Life Area',
      subtitle: `Choose ${choices.count} card(s) to place in ${targetDesc} life${posDesc}`,
      maxSelect: choices.count,
      confirmLabel: 'Move to Life',
      items: choices.targets.map((t, i) => {
        let card, label;
        if (choices.sourceZone === 'hand') {
          card  = state[t.ownerKey].hand[t.index];
          label = `${card.name} (Cost ${card.cost ?? 0})`;
        } else {
          const fc = state[t.ownerKey].characterArea[t.index];
          card  = fc.card;
          label = `${card.name} (${card.power?.toLocaleString() ?? '?'})${t.ownerKey !== pendingEffect.owner ? ' [Opp]' : ''}`;
        }
        return { key: i, card, label, eligible: true };
      }),
    };
  }

  if (type === 'CHOOSE_DON_UNREST') return {
    title: 'Activate DON!!',
    subtitle: `Choose up to ${choices.max} rested DON!! to set active`,
    maxSelect: choices.max,
    canSkip: true,
    items: choices.options.map((_, i) => ({ key: i, card: null, donLabel: 'Rested', sourceLabel: 'Cost Area', eligible: true })),
  };

  if (type === 'CHOOSE_DON_RETURN') {
    const ps = state[pendingEffect.owner];
    return {
      title: 'Return DON!!',
      subtitle: `Choose ${choices.count} DON!! to return to DON!! deck`,
      maxSelect: choices.count,
      confirmLabel: `Return ${choices.count} DON!!`,
      items: choices.options.map((opt, i) => {
        let donLabel, sourceLabel;
        if (opt.source === 'cost') {
          donLabel = opt.state === 'active' ? 'Active' : 'Rested';
          sourceLabel = 'Cost Area';
        } else if (opt.source === 'leader') {
          donLabel = 'Attached';
          sourceLabel = ps.leader.card?.name ?? 'Leader';
        } else {
          donLabel = 'Attached';
          sourceLabel = ps.characterArea[opt.charIndex]?.card?.name ?? 'Character';
        }
        return { key: i, card: null, donLabel, sourceLabel, eligible: true };
      }),
    };
  }

  if (type === 'SEARCH_ORDER') return {
    title: choices.canPlaceOnTop ? 'Arrange Cards' : 'Arrange Bottom Cards',
    subtitle: 'Pre-assigned left→right — tap to deselect, tap again to move to end',
    maxSelect: choices.remaining.length,
    confirmLabel: 'Confirm Order',
    items: choices.remaining.map((card, i) => ({ key: i, card, label: card.name, eligible: true })),
  };

  if (type === 'CHOOSE_DON_ATTACH_TARGET') {
    const aps = state[pendingEffect.owner];
    return {
      title: 'Attach DON!!',
      subtitle: `Choose a target to attach ${choices.count} DON!!${choices.donState === 'rest' ? ' (rested)' : ''}`,
      maxSelect: 1,
      canSkip: true,
      items: choices.targets.map((t, i) => {
        const card = t.zone === 'leader' ? aps.leader.card : aps.characterArea[t.index].card;
        return { key: i, card, label: card.name, eligible: true };
      }),
    };
  }

  if (type === 'CHOOSE_LIFE_TO_HAND_POSITION') return {
    title: 'Take Life Card',
    subtitle: 'Choose which life card to take to hand',
    maxSelect: 0,
    confirmLabel: 'Take',
    items: [],
  };

  return null;
}

/**
 * Modal for interactive card effect choices and full-field replacement.
 * Shows replace UI when pendingReplace is set; effect UI when pendingEffect is set.
 */
export default function EffectModal({ pendingEffect, pendingReplace, state, onResolve, onReplace }) {
  const [selected, setSelected] = useState([]);
  const [placeOnTop, setPlaceOnTop] = useState(false);
  const [koDiscardMode, setKoDiscardMode] = useState(null); // null | 'ko' | 'discard'
  const [deployZone, setDeployZone] = useState(null); // null | 'hand' | 'trash'

  const modalType = pendingReplace ? 'replace' : pendingEffect ? 'effect' : null;
  useEffect(() => { setSelected([]); setPlaceOnTop(false); setKoDiscardMode(null); setDeployZone(null); }, [modalType]);
  useEffect(() => {
    if (pendingEffect?.choices?.orderMode) {
      const { indices, max } = pendingEffect.choices;
      setSelected(indices.slice(0, max ?? 1));
    } else if (pendingEffect?.choices?.type === 'SEARCH_ORDER') {
      const n = pendingEffect.choices.remaining.length;
      setSelected(Array.from({ length: n }, (_, i) => i));
    }
  }, [pendingEffect?.choices?.type]);

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
      <DraggablePanel>
        <div className="bg-slate-900 border border-orange-500/40 overflow-hidden pb-safe">

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
      </DraggablePanel>
    );
  }

  // ── Effect modal ────────────────────────────────────────────────────────────

  const { sourceCard, choices } = pendingEffect;

  // ── Optional life-card take ────────────────────────────────────────────────
  if (choices.type === 'CHOOSE_LIFE_OPTIONAL') {
    return (
      <DraggablePanel>
        <div className="bg-slate-900/95 border border-blue-500/40 overflow-hidden pb-safe">
          <div className="bg-blue-700 px-3 py-1.5 flex items-center gap-2">
            <span className="text-white font-black text-xs uppercase tracking-widest">✦ Effect</span>
            <span className="text-blue-200 text-xs truncate ml-auto">{sourceCard?.name}</span>
          </div>
          <div className="px-3 pt-2 pb-1">
            {pendingEffect.owner !== choices.targetOwner ? (
              <>
                <p className="text-white font-black text-sm">Add opponent&apos;s top life card to their hand?</p>
                <p className="text-slate-400 text-xs mt-0.5">The opponent will draw their top life card.</p>
              </>
            ) : (
              <>
                <p className="text-white font-black text-sm">Take a life card?</p>
                <p className="text-slate-400 text-xs mt-0.5">Move your top life card to your hand.</p>
              </>
            )}
          </div>
          <div className="flex gap-2 px-3 pb-3 pt-2">
            <button
              onClick={() => { onResolve([]); }}
              className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm rounded-xl active:scale-95 transition-all"
            >
              No
            </button>
            <button
              onClick={() => { onResolve([1]); }}
              className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white font-black text-sm rounded-xl active:scale-95 transition-all"
            >
              Yes
            </button>
          </div>
        </div>
      </DraggablePanel>
    );
  }

  // ── Confirmation modal (optional cost) ─────────────────────────────────────
  if (choices.type === 'CONFIRM_OPTIONAL_ACTIVATION') {
    return (
      <DraggablePanel>
        <div className="bg-slate-900/95 border border-blue-500/40 overflow-hidden pb-safe">
          <div className="bg-blue-700 px-3 py-1.5 flex items-center gap-2">
            <span className="text-white font-black text-xs uppercase tracking-widest">✦ Effect</span>
            <span className="text-blue-200 text-xs truncate ml-auto">{sourceCard?.name}</span>
          </div>
          <div className="px-3 pt-2 pb-1 flex items-baseline gap-2">
            <p className="text-white font-black text-sm">Activate?</p>
            <p className="text-slate-400 text-xs">
              <span className="text-slate-300 font-semibold">Cost: </span>
              {choices.costDescription}
            </p>
          </div>
          <div className="flex gap-2 px-3 pb-3 pt-2">
            <button
              onClick={() => { onResolve([]); }}
              className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm rounded-xl active:scale-95 transition-all"
            >
              Skip
            </button>
            <button
              onClick={() => { onResolve([1]); }}
              className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white font-black text-sm rounded-xl active:scale-95 transition-all"
            >
              Activate
            </button>
          </div>
        </div>
      </DraggablePanel>
    );
  }

  // ── KO or Discard: two-step UI (mode selector → card picker) ──────────────
  if (choices.type === 'CHOOSE_KO_OR_DISCARD_HAND') {
    const ps = state[pendingEffect.owner];
    const hasFieldTargets = choices.fieldTargets.length > 0;

    // Step 1: mode selector
    if (koDiscardMode === null) {
      return (
        <DraggablePanel>
          <div className="bg-slate-900 border border-blue-500/40 overflow-hidden pb-safe">
            <div className="bg-blue-700 px-4 py-2 flex items-center gap-2">
              <span className="text-white font-black text-xs uppercase tracking-widest">✦ Effect</span>
              <span className="text-blue-200 text-xs truncate ml-auto">{sourceCard?.name}</span>
            </div>
            <div className="px-4 pt-3 pb-1">
              <p className="text-white font-black text-sm">KO or Discard</p>
              <p className="text-slate-400 text-xs mt-0.5">Choose how to pay the cost</p>
            </div>
            <div className="px-4 pb-3 pt-3 flex flex-col gap-3">
              <button
                onClick={() => setKoDiscardMode('ko')}
                disabled={!hasFieldTargets}
                className={`w-full py-4 rounded-xl font-black text-sm active:scale-95 transition-all flex items-center justify-between px-4
                  ${hasFieldTargets
                    ? 'bg-red-700 hover:bg-red-600 text-white'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
              >
                <span>KO Character from Field</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${hasFieldTargets ? 'bg-red-900/60 text-red-200' : 'bg-slate-700 text-slate-500'}`}>
                  {choices.fieldTargets.length} eligible
                </span>
              </button>
              <button
                onClick={() => setKoDiscardMode('discard')}
                className="w-full py-4 rounded-xl font-black text-sm bg-blue-700 hover:bg-blue-600 text-white active:scale-95 transition-all flex items-center justify-between px-4"
              >
                <span>Discard from Hand</span>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-900/60 text-blue-200">
                  {choices.handIndices.length} cards
                </span>
              </button>
            </div>
            <div className="flex px-4 pb-4 pt-1 border-t border-slate-700">
              <button
                onClick={() => { onResolve([]); }}
                className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm rounded-xl active:scale-95 transition-all"
              >
                Skip
              </button>
            </div>
          </div>
        </DraggablePanel>
      );
    }

    // Step 2a: pick a field character to KO
    if (koDiscardMode === 'ko') {
      return (
        <DraggablePanel>
          <div className="bg-slate-900 border border-red-500/40 overflow-hidden pb-safe">
            <div className="bg-red-700 px-4 py-2 flex items-center gap-2">
              <span className="text-white font-black text-xs uppercase tracking-widest">✦ KO Character</span>
              <span className="text-red-200 text-xs truncate ml-auto">{sourceCard?.name}</span>
            </div>
            <div className="px-4 pt-3 pb-1">
              <p className="text-white font-black text-sm">Choose a Character to KO</p>
              <p className="text-slate-400 text-xs mt-0.5">Selected character will be sent to trash</p>
            </div>
            <div className="px-4 pb-3 overflow-y-auto max-h-56">
              <div className="flex flex-wrap gap-2 pt-2">
                {choices.fieldTargets.map((t, i) => {
                  const fc = ps.characterArea[t.charIndex];
                  const isSelected = selected.includes(i);
                  return (
                    <button
                      key={i}
                      onClick={() => setSelected([i])}
                      className={`relative flex-shrink-0 rounded-xl border-2 transition-all active:scale-95
                        ${isSelected ? 'border-red-400 shadow-lg shadow-red-500/40 scale-105' : 'border-slate-600 opacity-80'}`}
                    >
                      <img
                        src={getSafeImageUrl(fc.card)}
                        alt={fc.card.name}
                        className="w-16 rounded-xl object-cover"
                        style={{ height: '5.5rem' }}
                        onError={e => { e.target.src = '/images/card_back.png'; }}
                      />
                      <div className="absolute bottom-1 left-0 right-0 text-center">
                        <span className="bg-slate-900/80 text-white text-[8px] font-bold px-1 rounded">{fc.card.cost ?? ''}</span>
                      </div>
                      {isSelected && (
                        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-red-500/30">
                          <span className="text-white text-lg font-black">✕</span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex gap-2 px-4 pb-4 pt-2 border-t border-slate-700">
              <button
                onClick={() => { setSelected([]); setKoDiscardMode(null); }}
                className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm rounded-xl active:scale-95 transition-all"
              >
                ← Back
              </button>
              <button
                onClick={() => { onResolve(selected); setSelected([]); setKoDiscardMode(null); }}
                disabled={selected.length === 0}
                className={`flex-1 py-3 font-black text-sm rounded-xl active:scale-95 transition-all
                  ${selected.length > 0 ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
              >
                KO
              </button>
            </div>
          </div>
        </DraggablePanel>
      );
    }

    // Step 2b: pick a hand card to discard
    return (
      <DraggablePanel>
        <div className="bg-slate-900 border border-blue-500/40 overflow-hidden pb-safe">
          <div className="bg-blue-700 px-4 py-2 flex items-center gap-2">
            <span className="text-white font-black text-xs uppercase tracking-widest">✦ Discard from Hand</span>
            <span className="text-blue-200 text-xs truncate ml-auto">{sourceCard?.name}</span>
          </div>
          <div className="px-4 pt-3 pb-1">
            <p className="text-white font-black text-sm">Choose a Card to Discard</p>
            <p className="text-slate-400 text-xs mt-0.5">Selected card will be sent to trash</p>
          </div>
          <div className="px-4 pb-3 overflow-y-auto max-h-56">
            <div className="flex flex-wrap gap-2 pt-2">
              {choices.handIndices.map((hi, i) => {
                const card = ps.hand[hi];
                const key = choices.fieldTargets.length + i;
                const isSelected = selected.includes(key);
                return (
                  <button
                    key={key}
                    onClick={() => setSelected([key])}
                    className={`relative flex-shrink-0 rounded-xl border-2 transition-all active:scale-95
                      ${isSelected ? 'border-blue-400 shadow-lg shadow-blue-500/40 scale-105' : 'border-slate-600 opacity-80'}`}
                  >
                    <img
                      src={getSafeImageUrl(card)}
                      alt={card.name}
                      className="w-16 rounded-xl object-cover"
                      style={{ height: '5.5rem' }}
                      onError={e => { e.target.src = '/images/card_back.png'; }}
                    />
                    <div className="absolute bottom-1 left-0 right-0 text-center">
                      <span className="bg-slate-900/80 text-white text-[8px] font-bold px-1 rounded">{card.cost ?? ''}</span>
                    </div>
                    {isSelected && (
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
            <button
              onClick={() => { setSelected([]); setKoDiscardMode(null); }}
              className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm rounded-xl active:scale-95 transition-all"
            >
              ← Back
            </button>
            <button
              onClick={() => { onResolve(selected); setSelected([]); setKoDiscardMode(null); }}
              disabled={selected.length === 0}
              className={`flex-1 py-3 font-black text-sm rounded-xl active:scale-95 transition-all
                ${selected.length > 0 ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
            >
              Discard
            </button>
          </div>
        </div>
      </DraggablePanel>
    );
  }

  // ── Deploy from Hand or Trash: two-step UI (zone selector → card picker) ──
  if (choices.type === 'CHOOSE_DEPLOY_FROM_HAND_OR_TRASH') {
    const ps = state[choices.sourceOwner];
    const hasHand  = choices.handIndices.length > 0;
    const hasTrash = choices.trashIndices.length > 0;

    // Step 1: pick zone
    if (deployZone === null) {
      return (
        <DraggablePanel>
          <div className="bg-slate-900 border border-blue-500/40 overflow-hidden pb-safe">
            <div className="bg-blue-700 px-4 py-2 flex items-center gap-2">
              <span className="text-white font-black text-xs uppercase tracking-widest">✦ Effect</span>
              <span className="text-blue-200 text-xs truncate ml-auto">{sourceCard?.name}</span>
            </div>
            <div className="px-4 pt-3 pb-1">
              <p className="text-white font-black text-sm">Deploy from Hand or Trash</p>
              <p className="text-slate-400 text-xs mt-0.5">Choose which zone to play from</p>
            </div>
            <div className="px-4 pb-3 pt-3 flex flex-col gap-3">
              <button
                onClick={() => { setDeployZone('hand'); setSelected([]); }}
                disabled={!hasHand}
                className={`w-full py-4 rounded-xl font-black text-sm active:scale-95 transition-all flex items-center justify-between px-4
                  ${hasHand
                    ? 'bg-blue-700 hover:bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
              >
                <span>Hand</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${hasHand ? 'bg-blue-900/60 text-blue-200' : 'bg-slate-700 text-slate-500'}`}>
                  {choices.handIndices.length} eligible
                </span>
              </button>
              <button
                onClick={() => { setDeployZone('trash'); setSelected([]); }}
                disabled={!hasTrash}
                className={`w-full py-4 rounded-xl font-black text-sm active:scale-95 transition-all flex items-center justify-between px-4
                  ${hasTrash
                    ? 'bg-slate-600 hover:bg-slate-500 text-white'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
              >
                <span>Trash</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${hasTrash ? 'bg-slate-700 text-slate-300' : 'bg-slate-700 text-slate-500'}`}>
                  {choices.trashIndices.length} eligible
                </span>
              </button>
            </div>
            <div className="flex px-4 pb-4 pt-1 border-t border-slate-700">
              <button
                onClick={() => { onResolve([]); }}
                className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm rounded-xl active:scale-95 transition-all"
              >
                Skip
              </button>
            </div>
          </div>
        </DraggablePanel>
      );
    }

    // Step 2: pick card from chosen zone
    const zoneIndices = deployZone === 'hand' ? choices.handIndices : choices.trashIndices;
    const zonePool    = deployZone === 'hand' ? ps.hand : ps.trash;
    return (
      <DraggablePanel>
        <div className="bg-slate-900 border border-blue-500/40 overflow-hidden pb-safe">
          <div className="bg-blue-700 px-4 py-2 flex items-center gap-2">
            <span className="text-white font-black text-xs uppercase tracking-widest">
              ✦ Deploy from {deployZone === 'hand' ? 'Hand' : 'Trash'}
            </span>
            <span className="text-blue-200 text-xs truncate ml-auto">{sourceCard?.name}</span>
          </div>
          <div className="px-4 pt-3 pb-1">
            <p className="text-white font-black text-sm">Choose up to {choices.max} card(s) to deploy for free</p>
          </div>
          <div className="px-4 pb-3 overflow-y-auto max-h-56">
            <div className="flex flex-wrap gap-2 pt-2">
              {zoneIndices.map(i => {
                const card = zonePool[i];
                const isSelected = selected.includes(i);
                return (
                  <button
                    key={i}
                    onClick={() => setSelected(prev =>
                      prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i].slice(0, choices.max)
                    )}
                    className={`relative flex-shrink-0 rounded-xl border-2 transition-all active:scale-95
                      ${isSelected ? 'border-blue-400 shadow-lg shadow-blue-500/40 scale-105' : 'border-slate-600 opacity-80'}`}
                  >
                    <img
                      src={getSafeImageUrl(card)}
                      alt={card.name}
                      className="w-16 rounded-xl object-cover"
                      style={{ height: '5.5rem' }}
                      onError={e => { e.target.src = '/images/card_back.png'; }}
                    />
                    <div className="absolute bottom-1 left-0 right-0 text-center">
                      <span className="bg-slate-900/80 text-white text-[8px] font-bold px-1 rounded">
                        Cost {card.cost ?? 0}
                      </span>
                    </div>
                    {isSelected && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-blue-500/30">
                        <span className="text-white text-2xl font-black">✓</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex gap-2 px-4 pb-4 pt-2 border-t border-slate-700">
            <button
              onClick={() => { setDeployZone(null); setSelected([]); }}
              className="px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm rounded-xl active:scale-95 transition-all"
            >
              ← Back
            </button>
            <button
              onClick={() => { onResolve(selected, { selectedZone: deployZone }); setSelected([]); setDeployZone(null); }}
              disabled={selected.length === 0}
              className={`flex-1 py-3 font-black text-sm rounded-xl active:scale-95 transition-all
                ${selected.length > 0 ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
            >
              Deploy
            </button>
          </div>
        </div>
      </DraggablePanel>
    );
  }

  if (choices.type === 'CHOOSE_TRASH_CARD_DEST') {
    return (
      <DraggablePanel>
        <div className="bg-slate-900 border border-purple-500/40 overflow-hidden pb-safe">
          <div className="bg-purple-700 px-4 py-2 flex items-center gap-2">
            <span className="text-white font-black text-xs uppercase tracking-widest">⊕ Choose Destination</span>
            <span className="text-purple-200 text-xs truncate ml-auto">{sourceCard?.name}</span>
          </div>
          <div className="px-4 pt-3 pb-1">
            <p className="text-white font-black text-sm">{choices.cardName} — choose where to send it</p>
          </div>
          <div className="px-4 pb-4 flex flex-col gap-2 pt-2">
            <button
              onClick={() => onResolve([0])}
              className="w-full py-3 px-4 text-left rounded-xl border-2 border-slate-600 bg-slate-800 hover:border-yellow-400 hover:bg-yellow-900/30 active:scale-95 transition-all"
            >
              <span className="text-white text-sm font-semibold leading-snug">Add face-up to top of life deck</span>
            </button>
            <button
              onClick={() => onResolve([1])}
              className="w-full py-3 px-4 text-left rounded-xl border-2 border-slate-600 bg-slate-800 hover:border-green-400 hover:bg-green-900/30 active:scale-95 transition-all"
            >
              <span className="text-white text-sm font-semibold leading-snug">Deploy to field</span>
            </button>
          </div>
        </div>
      </DraggablePanel>
    );
  }

  if (choices.type === 'CHOOSE_ONE_OPTION') {
    return (
      <DraggablePanel>
        <div className="bg-slate-900 border border-purple-500/40 overflow-hidden pb-safe">
          <div className="bg-purple-700 px-4 py-2 flex items-center gap-2">
            <span className="text-white font-black text-xs uppercase tracking-widest">⊕ Choose One</span>
            <span className="text-purple-200 text-xs truncate ml-auto">{sourceCard?.name}</span>
          </div>
          <div className="px-4 pt-3 pb-1">
            <p className="text-white font-black text-sm">Select one effect to activate</p>
          </div>
          <div className="px-4 pb-4 flex flex-col gap-2 pt-2">
            {choices.options.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => onResolve([key])}
                className="w-full py-3 px-4 text-left rounded-xl border-2 border-slate-600 bg-slate-800 hover:border-purple-400 hover:bg-purple-900/30 active:scale-95 transition-all"
              >
                <span className="text-white text-sm font-semibold leading-snug">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </DraggablePanel>
    );
  }

  const choiceConfig = buildChoiceConfig(choices, pendingEffect, state);
  if (!choiceConfig) return null;

  const { title, subtitle, items, maxSelect, canSkip, canCancel } = choiceConfig;
  let confirmLabel = choiceConfig.confirmLabel ?? 'Confirm';
  if (choices.type === 'SEARCH_PICK')      confirmLabel = `Take ${selected.length}`;
  if (choices.type === 'CHOOSE_DISCARD_FREE') confirmLabel = selected.length ? `Discard ${selected.length}` : 'Skip';
  if (choices.type === 'CHOOSE_FREE_EVENT')   confirmLabel = selected.length ? `Activate ${selected.length}` : 'Skip';
  if (choices.type === 'CHOOSE_DON_UNREST')   confirmLabel = selected.length ? `Activate ${selected.length}` : 'Skip';

  function toggle(key) {
    const item = items.find(it => it.key === key);
    if (item?.eligible === false) return;
    if (choices.type === 'SEARCH_ORDER' || choices.orderMode) {
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
    if (choices.type === 'CHOOSE_LIFE_TO_HAND_POSITION') {
      result = [placeOnTop ? -1 : -2];
    }
    onResolve(result);
    setSelected([]);
    setPlaceOnTop(false);
  }

  function skip() {
    onResolve([]);
    setSelected([]);
  }

  function cancel() {
    onResolve('CANCEL');
    setSelected([]);
  }

  const canConfirm = choices.type === 'CHOOSE_LIFE_TO_HAND_POSITION'
    ? true
    : choices.type === 'CHOOSE_DISCARD'
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
    <DraggablePanel>
      <div className="bg-slate-900 border border-blue-500/40 overflow-hidden pb-safe">

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

        {(choices.type === 'CHOOSE_ADD_TO_LIFE' && choices.positionChoice ||
          choices.type === 'CHOOSE_LIFE_TO_HAND_POSITION') && (
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
                  {isSelected && (choices.type === 'SEARCH_ORDER' || choices.orderMode) && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-blue-500/30">
                      <span className="bg-blue-600 text-white text-sm font-black w-7 h-7 rounded-full flex items-center justify-center">
                        {selected.indexOf(key) + 1}
                      </span>
                    </div>
                  )}
                  {isSelected && choices.type !== 'SEARCH_ORDER' && !choices.orderMode && (
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
          {canCancel && (
            <button
              onClick={cancel}
              className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm rounded-xl active:scale-95 transition-all"
            >
              Cancel
            </button>
          )}
          {canSkip && !canCancel && (
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
    </DraggablePanel>
  );
}
