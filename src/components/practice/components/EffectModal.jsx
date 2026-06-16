import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { getSafeImageUrl, cardBackImg } from '../../../utils/cardHelpers';
import { formatEffectText } from '../../../utils/formatEffect';
import DraggablePanel from './DraggablePanel';
import CardDetailOverlay from './CardDetailOverlay';

function buildChoiceConfig(choices, pendingEffect, state, getName) {
  const { type } = choices;

  if (type === 'CHOOSE_KO_TARGET') return {
    title: 'Choose KO Target',
    subtitle: `KO up to ${pendingEffect.action.count ?? 1} card(s)`,
    maxSelect: pendingEffect.action.count ?? 1,
    canSkip: true,
    items: choices.indices.map(i => ({
      key: i,
      card: state[choices.targetOwner].characterArea[i].card,
      label: `${getName(state[choices.targetOwner].characterArea[i].card)} (${state[choices.targetOwner].characterArea[i].card.power ?? '?'})`,
    })),
  };

  if (type === 'CHOOSE_CONDITIONAL_KO_TARGET') return {
    title: 'Select Target',
    subtitle: 'Choose a rested opponent character — K.O. it if its cost equals its attached DON!! count.',
    maxSelect: 1,
    canSkip: true,
    items: choices.indices.map(i => {
      const fc = state[choices.targetOwner].characterArea[i];
      return {
        key: i,
        card: fc.card,
        label: `${getName(fc.card)} (cost ${fc.card.cost ?? '?'}, ${fc.attachedDon} DON!!)`,
      };
    }),
  };

  if (type === 'CHOOSE_REDIRECT_ATTACK_TARGET') {
    const rps = state[pendingEffect.owner];
    return {
      title: 'Redirect Attack',
      subtitle: 'Choose a new attack target',
      maxSelect: 1,
      items: choices.targets.map((t, i) => {
        if (t.zone === 'leader') return { key: i, card: rps.leader.card, label: `${getName(rps.leader.card)} [Leader]` };
        return { key: i, card: rps.characterArea[t.index].card, label: getName(rps.characterArea[t.index].card) };
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
        label: `${getName(fc.card)} (Cost ${fc.card.cost ?? 0})${t.owner !== pendingEffect.owner ? ' [Opp]' : ''}`,
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
          label: `${getName(state[choices.sourceOwner].trash[i])} (Cost ${state[choices.sourceOwner].trash[i].cost ?? 0})`,
        }))
      : choices.targets.map((t, i) => {
          const fc = state[t.owner].characterArea[t.charIndex];
          return { key: i, card: fc.card, label: `${getName(fc.card)} (Cost ${fc.card.cost ?? 0})` };
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
          label: `${getName(state[choices.targetOwner].trash[i])} (Cost ${state[choices.targetOwner].trash[i].cost ?? 0})`,
        }))
      : choices.indices.map(i => ({
          key: i,
          card: state[choices.targetOwner].characterArea[i].card,
          label: `${getName(state[choices.targetOwner].characterArea[i].card)} (${state[choices.targetOwner].characterArea[i].card.power ?? '?'})`,
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
            if (t.zone === 'leader')    return { key: i, card: tps.leader.card,                 label: `${getName(tps.leader.card)} [Leader]` };
            if (t.zone === 'character') return { key: i, card: tps.characterArea[t.index].card, label: getName(tps.characterArea[t.index].card) };
            if (t.zone === 'stage')     return { key: i, card: tps.stageArea.card,               label: `${getName(tps.stageArea.card)} [Stage]` };
            return { key: i, card: null, label: 'DON!!' };
          })
        : choices.indices.map(i => ({
            key: i,
            card: tps.characterArea[i].card,
            label: getName(tps.characterArea[i].card),
          })),
    };
  }

  if (type === 'CHOOSE_GRANT_KEYWORD_TARGET') {
    const tps = state[choices.targetOwner];
    return {
      title: `Grant 【${choices.keyword}】`,
      subtitle: `Choose up to ${choices.max} character(s) to gain 【${choices.keyword}】`,
      maxSelect: choices.max,
      canSkip: true,
      items: choices.indices.map(i => {
        if (i === 'leader') {
          return { key: 'leader', card: tps.leader.card, label: `${getName(tps.leader.card)} [Leader]` };
        }
        return {
          key: i,
          card: tps.characterArea[i].card,
          label: `${getName(tps.characterArea[i].card)} (Cost ${tps.characterArea[i].card.cost ?? 0})`,
        };
      }),
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
      return { key: i, card, label: `${getName(card)}${t.zone === 'leader' ? ' [Leader]' : ''}` };
    }),
  };

  if (type === 'CHOOSE_REFRESH_LOCK_TARGET') return {
    title: 'Choose Refresh Lock Target',
    subtitle: `Choose up to ${choices.max} rested opponent card(s) — they cannot refresh next turn`,
    maxSelect: choices.max,
    canSkip: true,
    items: choices.targets.map((t, i) => {
      const tps = state[choices.targetOwner];
      if (t.zone === 'leader') return { key: i, card: tps.leader.card, label: `${getName(tps.leader.card)} [Leader]` };
      if (t.zone === 'don')    return { key: i, card: null, label: 'DON!!' };
      return { key: i, card: tps.characterArea[t.index].card, label: `${getName(tps.characterArea[t.index].card)} (Cost ${tps.characterArea[t.index].card.cost ?? 0})` };
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
      label: `${getName(state[choices.targetOwner].characterArea[i].card)} (Cost ${state[choices.targetOwner].characterArea[i].card.cost ?? 0})`,
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
      label: `${getName(state[choices.targetOwner].characterArea[i].card)} (Cost ${state[choices.targetOwner].characterArea[i].card.cost ?? 0})`,
    })),
  };

  if (type === 'CHOOSE_BLOCK_DISABLE_TARGET') return {
    title: 'Disable Blocker',
    subtitle: `Choose up to ${choices.max} opponent character(s) with [Blocker] — cannot activate it this turn`,
    maxSelect: choices.max,
    canSkip: true,
    items: choices.indices.map(i => ({
      key: i,
      card: state[choices.targetOwner].characterArea[i].card,
      label: `${getName(state[choices.targetOwner].characterArea[i].card)} (Cost ${state[choices.targetOwner].characterArea[i].card.cost ?? 0})`,
    })),
  };

  if (type === 'CHOOSE_NULL_EFFECT_TARGET') {
    const pmSuffix = choices.linkedPowerMod
      ? ` + ${choices.linkedPowerMod.delta > 0 ? '+' : ''}${choices.linkedPowerMod.delta} power`
      : '';
    return {
      title: 'Negate Effect',
      subtitle: `Choose up to ${choices.max} card(s) — effects negated until ${choices.until === 'nextOppTurn' ? "end of opponent's next turn" : 'end of turn'}${pmSuffix}`,
      maxSelect: choices.max,
      canSkip: true,
      items: choices.indices.map(i => {
        const card = i === -1
          ? state[choices.targetOwner].leader.card
          : state[choices.targetOwner].characterArea[i].card;
        return { key: i, card, label: `${getName(card)} (Cost ${card.cost ?? 0})` };
      }),
    };
  }

  if (type === 'CHOOSE_POWER_PAIR_TARGETS') {
    const pairPs = state[choices.targetOwner];
    const [d1, d2] = pendingEffect.action.deltas;
    return {
      title: 'Choose Power Targets',
      subtitle: `Select up to ${choices.max}: 1st target ${d1 > 0 ? '+' : ''}${d1}, 2nd target ${d2 > 0 ? '+' : ''}${d2}`,
      maxSelect: choices.max,
      canSkip: true,
      items: choices.targets.map((t, i) => {
        const card = t.zone === 'leader' ? pairPs.leader.card : pairPs.characterArea[t.index].card;
        return { key: i, card, label: `${getName(card)} (${card.power ?? '?'})` };
      }),
    };
  }

  if (type === 'CHOOSE_POWER_TARGET') {
    const pmPs = state[choices.targetOwner];
    const pmAction = pendingEffect.action;
    const pmSubtitle = pmAction.power !== undefined
      ? `Set base power to ${pmAction.power}`
      : (() => { const d = pmAction.totalDelta ?? pmAction.delta ?? 0; return `Apply ${d > 0 ? '+' : ''}${d} power`; })();
    return {
      title: 'Choose Power Target',
      subtitle: pmSubtitle,
      maxSelect: 1,
      canSkip: true,
      items: choices.targets.map((t, i) => {
        const card = t.zone === 'leader' ? pmPs.leader.card : pmPs.characterArea[t.index].card;
        return { key: i, card, label: `${getName(card)} (${card.power ?? '?'})` };
      }),
    };
  }

  if (type === 'CHOOSE_SWAP_POWER_TARGET') {
    const swapOwner = pendingEffect.owner;
    if (choices.leaderTarget) {
      const leaderCard = state[swapOwner].leader.card;
      return {
        title: 'Swap Base Power with Leader',
        subtitle: `Leader (${leaderCard.power ?? '?'}) — choose 1 character to swap base power for this battle`,
        maxSelect: 1,
        canSkip: false,
        items: choices.targets.map((t, i) => {
          const card = state[swapOwner].characterArea[t.index].card;
          return { key: i, card, label: `${getName(card)} (${card.power ?? '?'})` };
        }),
      };
    }
    return {
      title: 'Swap Base Power',
      subtitle: 'Choose 2 characters to swap base power this turn',
      maxSelect: 2,
      canSkip: false,
      items: choices.targets.map((t, i) => {
        const card = state[swapOwner].characterArea[t.index].card;
        return { key: i, card, label: `${getName(card)} (${card.power ?? '?'})` };
      }),
    };
  }

  if (type === 'CHOOSE_COPY_POWER_TARGET') {
    const ccptPs = state[choices.targetOwner];
    return {
      title: 'Copy Power',
      subtitle: `Select an opponent's character — this card's base power becomes theirs for this turn`,
      maxSelect: 1,
      canSkip: true,
      items: choices.targets.map((t, i) => {
        const card = ccptPs.characterArea[t.index].card;
        return { key: i, card, label: `${getName(card)} (${card.power ?? '?'})` };
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
      label: `${getName(state[choices.targetOwner].characterArea[i].card)} (Cost ${state[choices.targetOwner].characterArea[i].card.cost ?? 0})`,
    })),
  };

  if (type === 'CHOOSE_COST_SET_TARGET') return {
    title: 'Choose Cost Target',
    subtitle: `Set cost to ${pendingEffect.action.targetCost}`,
    maxSelect: 1,
    canSkip: true,
    items: choices.indices.map(i => ({
      key: i,
      card: state[choices.targetOwner].characterArea[i].card,
      label: `${getName(state[choices.targetOwner].characterArea[i].card)} (Cost ${state[choices.targetOwner].characterArea[i].card.cost ?? 0})`,
    })),
  };

  if (type === 'CHOOSE_DEPLOY_FROM_LIFE') return {
    title: 'Deploy from Life?',
    subtitle: `You may deploy ${getName(choices.lifeCard) ?? 'this card'} (Cost ${choices.lifeCard?.cost ?? '?'}) for free`,
    maxSelect: 1,
    canSkip: true,
    items: [{ key: 0, card: choices.lifeCard, label: `${getName(choices.lifeCard)} (Cost ${choices.lifeCard?.cost ?? '?'})` }],
  };

  if (type === 'CHOOSE_DEPLOY_FROM_DECK') {
    return {
      title: 'Deploy from Deck (Revealed)',
      subtitle: choices.eligibleIndices.length
        ? `Choose up to ${choices.max} card(s) from the revealed card(s) to deploy`
        : 'No eligible card revealed — all go to bottom of deck',
      maxSelect: choices.max,
      canSkip: true,
      items: choices.revealed.map((c, i) => ({
        key: i,
        card: c,
        label: `${getName(c)} (Cost ${c.cost ?? 0})`,
        eligible: choices.eligibleIndices.includes(i),
      })),
    };
  }

  if (type === 'CHOOSE_DEPLOY_FROM_HAND') return {
    title: 'Deploy from Hand',
    subtitle: choices.uniqueName
      ? `Choose up to ${choices.max} card(s) to deploy (each must have a different name)`
      : `Choose up to ${choices.max} card(s) to deploy for free`,
    maxSelect: choices.max,
    canSkip: true,
    items: choices.indices.map(i => ({
      key: i,
      card: state[choices.sourceOwner].hand[i],
      label: `${getName(state[choices.sourceOwner].hand[i])} (Cost ${state[choices.sourceOwner].hand[i].cost ?? 0})`,
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
      label: `${getName(state[choices.sourceOwner].trash[i])} (Cost ${state[choices.sourceOwner].trash[i].cost ?? 0})`,
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
      label: `${getName(state[pendingEffect.owner].characterArea[i].card)} (Cost ${state[pendingEffect.owner].characterArea[i].card.cost ?? 0})`,
    })),
  };

  if (type === 'CHOOSE_TRASH_RECYCLE') return {
    title: 'Return Cards to Deck',
    subtitle: `Choose exactly ${choices.count} card(s) from your trash to return to deck (deck will be shuffled)`,
    maxSelect: choices.count,
    canSkip: false,
    items: choices.indices.map(i => ({
      key: i,
      card: state[pendingEffect.owner].trash[i],
      label: `${getName(state[pendingEffect.owner].trash[i])} (Cost ${state[pendingEffect.owner].trash[i].cost ?? 0})`,
    })),
  };

  if (type === 'CHOOSE_TRASH_FOR_LIFE_OR_FIELD') {
    const srcZone = choices.sourceZone ?? 'trash';
    const srcPool = state[choices.sourceOwner][srcZone] ?? [];
    return {
      title: srcZone === 'hand' ? 'Choose Card from Hand' : 'Choose Card from Trash',
      subtitle: `Choose up to ${choices.max} card(s) to add face-up to life top or deploy`,
      maxSelect: choices.max,
      canSkip: true,
      items: choices.indices.map(i => ({
        key: i,
        card: srcPool[i],
        label: `${getName(srcPool[i])} (Cost ${srcPool[i]?.cost ?? 0})`,
      })),
    };
  }

  if (type === 'CHOOSE_DISCARD') {
    if (choices.fromZone === 'field') {
      const owner = pendingEffect.owner;
      return {
        title: 'Choose Character to Trash',
        subtitle: `Trash exactly ${choices.count} character(s) from your field`,
        maxSelect: choices.count,
        confirmLabel: `Trash ${choices.count}`,
        items: choices.indices.map(i => ({
          key: i,
          card: state[owner].characterArea[i]?.card,
          label: getName(state[owner].characterArea[i]?.card),
        })),
      };
    }
    return {
      title: 'Choose Cards to Discard',
      subtitle: `Discard exactly ${choices.count} card(s)`,
      maxSelect: choices.count,
      confirmLabel: `Discard ${choices.count}`,
      items: choices.indices.map(i => ({
        key: i,
        card: state[pendingEffect.owner].hand[i],
        label: getName(state[pendingEffect.owner].hand[i]),
      })),
    };
  }

  if (type === 'CHOOSE_REVEAL_CARDS') return {
    title: 'Reveal Cards',
    subtitle: `Reveal exactly ${choices.count} card(s) to the opponent (they stay in your hand)`,
    maxSelect: choices.count,
    confirmLabel: `Reveal ${choices.count}`,
    items: choices.indices.map(i => ({
      key: i,
      card: state[pendingEffect.owner].hand[i],
      label: getName(state[pendingEffect.owner].hand[i]),
    })),
  };

  if (type === 'CHOOSE_REVEAL_HAND') return {
    title: 'Reveal from Hand',
    subtitle: `Choose up to ${choices.max} matching card(s) to reveal`,
    maxSelect: choices.max,
    canSkip: false,
    items: choices.indices.map(i => ({
      key: i,
      card: state[pendingEffect.owner].hand[i],
      label: `${getName(state[pendingEffect.owner].hand[i])} (Cost ${state[pendingEffect.owner].hand[i].cost ?? 0})`,
      eligible: true,
    })),
  };

  if (type === 'CHOOSE_DEPLOY_REVEALED') {
    const restNote = choices.restIfCostLte !== null
      ? ` (other deploys rested if cost ≤ ${choices.restIfCostLte})`
      : '';
    return {
      title: 'Deploy Revealed Card',
      subtitle: `Choose ${choices.deployCount} card(s) to deploy active${restNote}`,
      maxSelect: choices.deployCount,
      canSkip: false,
      items: choices.revealed.map((card, i) => ({
        key: i,
        card,
        label: `${getName(card)} (Cost ${card.cost ?? 0})`,
        eligible: true,
      })),
    };
  }

  if (type === 'CHOOSE_HAND_TO_DECK') return {
    title: 'Place Hand Cards on Deck',
    subtitle: `Choose ${choices.max} card(s) to place on top or bottom of your deck`,
    maxSelect: choices.max,
    confirmLabel: `Place ${choices.max}`,
    items: choices.indices.map(i => ({
      key: i,
      card: state[pendingEffect.owner].hand[i],
      label: getName(state[pendingEffect.owner].hand[i]),
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
      label: getName(state[pendingEffect.owner].hand[i]),
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
      label: `${getName(state[pendingEffect.owner].hand[i])} (Cost ${state[pendingEffect.owner].hand[i].cost ?? 0})`,
    })),
  };

  if (type === 'SEARCH_PICK') {
    const hasFilter = choices.eligibleIndices && choices.eligibleIndices.length < choices.revealed.length;
    const destHint = choices.destination === 'life'
      ? 'chosen goes face-up to top of life, others go to bottom of deck'
      : choices.remainderToTrash ? 'others go to trash'
      : choices.canPlaceOnTop ? 'others go to top or bottom of deck'
      : 'others go back to the bottom';
    return {
      title: 'Search — Choose Cards',
      subtitle: hasFilter
        ? `Take up to ${choices.take} matching card(s) — ${destHint}`
        : `Take up to ${choices.take} card(s) — ${destHint}`,
      maxSelect: choices.take,
      items: choices.revealed.map((card, i) => ({
        key: i,
        card,
        label: `${getName(card)} (Cost ${card.cost ?? 0})`,
        eligible: !choices.eligibleIndices || choices.eligibleIndices.includes(i),
      })),
    };
  }

  if (type === 'CHOOSE_DEPLOY_FROM_REVEALED') {
    const destNote = choices.canPlaceOnTop ? '(others go to top or bottom of deck)' : '(others go to bottom of deck)';
    return {
      title: 'Deck Reveal — Deploy',
      subtitle: `Choose up to ${choices.max} card(s) to deploy ${destNote}`,
      maxSelect: choices.max,
      canSkip: true,
      items: choices.revealed.map((card, i) => ({
        key: i,
        card,
        label: `${getName(card)} (Cost ${card.cost ?? 0})`,
        eligible: choices.eligibleIndices.includes(i),
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
      label: getName(state[pendingEffect.owner].hand[i]),
      eligible: true,
    })),
  };

  if (type === 'CHOOSE_ADD_TO_LIFE') {
    const targetDesc = choices.targetOwner === 'opponent' ? "opponent's" : 'your';
    const posDesc    = choices.positionChoice ? '' : choices.position === 'bottom' ? ' (bottom)' : ' (top)';
    const orderHint  = !choices.positionChoice && choices.position !== 'bottom' && (choices.count ?? 1) > 1
      ? ' — select in order (1st = below, last = top)'
      : '';
    return {
      title: 'Move to Life Area',
      subtitle: `Choose ${choices.count} card(s) to place in ${targetDesc} life${posDesc}${orderHint}`,
      maxSelect: choices.count,
      confirmLabel: 'Move to Life',
      items: choices.targets.map((t, i) => {
        let card, label;
        const resolvedZone = t.zone ?? (choices.sourceZone === 'hand' ? 'hand' : 'character');
        if (resolvedZone === 'hand') {
          card  = state[t.ownerKey].hand[t.index];
          label = `${getName(card)} (Cost ${card.cost ?? 0})`;
        } else if (resolvedZone === 'trash') {
          card  = state[t.ownerKey].trash[t.index];
          label = `${getName(card)} (Cost ${card.cost ?? 0}) [Trash]`;
        } else {
          const fc = state[t.ownerKey].characterArea[t.index];
          card  = fc.card;
          const effectivePow = (card.power ?? 0) + (fc.attachedDon ?? 0) * 1000;
          label = `${getName(card)} (${effectivePow.toLocaleString()})${t.ownerKey !== pendingEffect.owner ? ' [Opp]' : ''}`;
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

  if (type === 'CHOOSE_OPP_DON_RETURN') {
    const activeDon = (state[pendingEffect.owner]?.costArea ?? []).filter(d => d.state === 'active');
    return {
      title: 'Return DON!!?',
      subtitle: `Return ${choices.count} active DON!! to your DON!! deck, or skip to take the penalty`,
      maxSelect: choices.count,
      canSkip: true,
      items: activeDon.map((_, i) => ({ key: i, card: null, donLabel: 'Active', sourceLabel: 'Cost Area', eligible: true })),
    };
  }

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
          sourceLabel = getName(ps.leader.card) ?? 'Leader' ?? 'Leader';
        } else {
          donLabel = 'Attached';
          sourceLabel = getName(ps.characterArea[opt.charIndex]?.card) ?? 'Character' ?? 'Character';
        }
        return { key: i, card: null, donLabel, sourceLabel, eligible: true };
      }),
    };
  }

  if (type === 'SEARCH_ORDER') return {
    title: choices.canPlaceOnTop ? 'Arrange Cards' : 'Arrange Bottom Cards',
    subtitle: 'Drag to reorder — leftmost = top (drawn first), rightmost = bottom',
    maxSelect: choices.remaining.length,
    confirmLabel: 'Confirm Order',
    items: choices.remaining.map((card, i) => ({ key: i, card, label: getName(card), eligible: true })),
  };

  if (type === 'CHOOSE_DON_ATTACH_TARGET') {
    const maxT = choices.maxTargets ?? 1;
    return {
      title: 'Attach DON!!',
      subtitle: `Choose up to ${maxT} target${maxT > 1 ? 's' : ''} to attach ${choices.count} DON!!${choices.donState === 'rest' ? ' (rested)' : ''} each`,
      maxSelect: maxT,
      canSkip: choices.canSkip ?? true,
      items: choices.targets.map((t, i) => {
        const tps = state[t.owner ?? choices.targetOwner ?? pendingEffect.owner];
        const card = t.zone === 'leader' ? tps.leader.card : tps.characterArea[t.index].card;
        return { key: i, card, label: getName(card), eligible: true };
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

  if (type === 'CHOOSE_ARRANGE_LIFE') return {
    title: 'Arrange Life Cards',
    subtitle: `Tap cards in the order you want (top → bottom). Must order all ${choices.lifeCards.length}.`,
    maxSelect: choices.lifeCards.length,
    confirmLabel: 'Confirm Order',
    items: choices.lifeCards.map((card, i) => ({ key: i, card, label: getName(card), eligible: true })),
  };

  if (type === 'CHOOSE_EOT_EFFECT_ORDER') return {
    title: '【我方回合結束時】效果順序',
    subtitle: '選擇哪張卡的效果先發動',
    maxSelect: 1,
    canSkip: false,
    items: choices.sources.map((src, i) => ({
      key: i,
      card: src.card,
      label: getName(src.card),
    })),
  };

  if (type === 'CHOOSE_ON_PLAY_ORDER') return {
    title: '【登場時】效果順序',
    subtitle: '選擇哪張卡的效果先發動',
    maxSelect: 1,
    canSkip: false,
    items: choices.sources.map((src, i) => ({
      key: i,
      card: src.card,
      label: getName(src.card),
    })),
  };

  return null;
}

/**
 * Modal for interactive card effect choices and full-field replacement.
 * Shows replace UI when pendingReplace is set; effect UI when pendingEffect is set.
 */
const TIMING_TITLES = {
  '攻擊時': 'When Attacking',
  '對方攻擊時': "On Opponent's Attack",
  '防禦時': 'On Block',
  '登場時': 'On Play',
  'KO時': 'On KO',
  '我方回合結束時': 'End of Turn',
  '我方回合開始時': 'Start of Turn',
  '離場時': 'On Leave',
  '觸發器': 'Trigger',
  '啟動主要': 'Activate: Main',
};

export default function EffectModal({ pendingEffect, pendingReplace, state, onResolve, onReplace, onHoverTarget }) {
  const [selected, setSelected] = useState([]);
  const [placeOnTop, setPlaceOnTop] = useState(true);
  const [koDiscardMode, setKoDiscardMode] = useState(null); // null | 'ko' | 'discard'
  const [deployZone, setDeployZone] = useState(null); // null | 'hand' | 'trash'
  const [hoveredCard, setHoveredCard] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const orderRowRef = useRef(null);
  const { i18n } = useTranslation();
  const isEn = i18n.language.startsWith('en');
  const langCode = isEn ? 'en' : 'zh';
  const getName = (card) => (isEn && card?.enName) ? card.enName : (card?.name ?? '');

  const timingTitle = TIMING_TITLES[pendingEffect?.timing] ?? 'Effect';

  const modalType = pendingReplace ? 'replace' : pendingEffect ? 'effect' : null;
  useEffect(() => { setSelected([]); setPlaceOnTop(true); setKoDiscardMode(null); setDeployZone(null); setHoveredCard(null); }, [modalType]);
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
            <span className="text-orange-200 text-xs truncate ml-auto">{getName(card)}</span>
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
                    onMouseEnter={() => onHoverTarget?.(i)}
                    onMouseLeave={() => onHoverTarget?.(null)}
                    className={`relative flex-shrink-0 rounded-xl border-2 transition-all active:scale-95
                      ${isSelected
                        ? 'border-orange-400 shadow-lg shadow-orange-500/40 scale-105'
                        : 'border-slate-600 opacity-80'
                      }`}
                  >
                    <img
                      src={getSafeImageUrl(fc.card)}
                      alt={getName(fc.card)}
                      className="w-16 rounded-xl object-cover"
                      style={{ height: '5.5rem' }}
                      onError={e => { e.target.src = cardBackImg; }}
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
  const ACTIVATE_MAIN_TIMINGS = new Set(['啟動主要', '起動メイン', 'Activate: Main']);

  // ── Optional life-card take ────────────────────────────────────────────────
  if (choices.type === 'CHOOSE_LIFE_OPTIONAL') {
    return (
      <DraggablePanel>
        <div className="bg-slate-900/95 border border-blue-500/40 overflow-hidden pb-safe">
          <div className="bg-blue-700 px-3 py-1.5 flex items-center gap-2">
            <span className="text-white font-black text-xs uppercase tracking-widest">✦ {timingTitle}</span>
            <span className="text-blue-200 text-xs truncate ml-auto">{getName(sourceCard)}</span>
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
    const timingTitle = TIMING_TITLES[pendingEffect.timing] ?? 'Effect';
    return (
      <DraggablePanel>
        <div className="bg-slate-900/95 border border-blue-500/40 overflow-hidden pb-safe">
          <div className="bg-blue-700 px-3 py-1.5 flex items-center gap-2">
            <span className="text-white font-black text-xs uppercase tracking-widest">✦ {timingTitle}</span>
          </div>
          <div className="flex gap-3 px-3 pt-3 pb-2 items-start">
            {sourceCard && (
              <img
                src={getSafeImageUrl(sourceCard)}
                alt={getName(sourceCard)}
                className="w-14 flex-shrink-0 rounded-lg object-cover border border-slate-600 shadow"
                style={{ height: '4.8rem' }}
                onError={e => { e.target.src = cardBackImg; }}
              />
            )}
            <p
              className="text-slate-200 text-sm leading-snug pt-0.5"
              dangerouslySetInnerHTML={{ __html: (() => {
                let raw;
                if (!isEn) {
                  raw = choices.costDescription;
                } else if (choices.costDescriptionEn) {
                  raw = choices.costDescriptionEn;
                } else if (sourceCard?.enEffect && choices.clauseRaw) {
                  const cnClauses = (sourceCard.effect ?? '').split(/<br\s*\/?>/i);
                  const enClauses = sourceCard.enEffect.split(/<br\s*\/?>/i);
                  const idx = cnClauses.findIndex(c => c.trim() === choices.clauseRaw.trim());
                  raw = (idx >= 0 && enClauses[idx]) ? enClauses[idx].trim() : sourceCard.enEffect.replace(/<br\s*\/?>/gi, ' ');
                } else {
                  raw = sourceCard?.enEffect?.replace(/<br\s*\/?>/gi, ' ') ?? choices.costDescription;
                }
                return formatEffectText(raw, langCode);
              })() }}
            />
          </div>
          <div className="flex gap-2 px-3 pb-3 pt-1">
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

  // ── AUTO_KO_IN_BATTLE: optional K.O. of battled opponent character (self-KO if yes) ──
  if (choices.type === 'CHOOSE_AUTO_KO_IN_BATTLE') {
    const targetName = getName(choices.targetCard) || 'opponent\'s character';
    return (
      <DraggablePanel>
        <div className="bg-slate-900/95 border border-red-500/40 overflow-hidden pb-safe">
          <div className="bg-red-700 px-3 py-1.5 flex items-center gap-2">
            <span className="text-white font-black text-xs uppercase tracking-widest">✦ {timingTitle}</span>
            <span className="text-red-200 text-xs truncate ml-auto">{getName(sourceCard)}</span>
          </div>
          <div className="px-3 pt-2 pb-1">
            <p className="text-white font-black text-sm">K.O. {targetName}?</p>
            <p className="text-slate-400 text-xs mt-0.5">If you do, {getName(sourceCard)} will also be K.O.'d.</p>
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
              className="flex-1 py-2 bg-red-600 hover:bg-red-500 text-white font-black text-sm rounded-xl active:scale-95 transition-all"
            >
              K.O.
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
              <span className="text-white font-black text-xs uppercase tracking-widest">✦ {timingTitle}</span>
              <span className="text-blue-200 text-xs truncate ml-auto">{getName(sourceCard)}</span>
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
            <div className="flex gap-2 px-4 pb-4 pt-1 border-t border-slate-700">
              {ACTIVATE_MAIN_TIMINGS.has(pendingEffect?.timing) && (
                <button
                  onClick={() => { onResolve('CANCEL'); }}
                  className="flex-1 py-3 bg-red-900/60 hover:bg-red-800/60 text-red-200 font-bold text-sm rounded-xl active:scale-95 transition-all"
                >
                  Cancel
                </button>
              )}
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
              <span className="text-red-200 text-xs truncate ml-auto">{getName(sourceCard)}</span>
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
                        alt={getName(fc.card)}
                        className="w-16 rounded-xl object-cover"
                        style={{ height: '5.5rem' }}
                        onError={e => { e.target.src = cardBackImg; }}
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
            <span className="text-blue-200 text-xs truncate ml-auto">{getName(sourceCard)}</span>
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
                      alt={getName(card)}
                      className="w-16 rounded-xl object-cover"
                      style={{ height: '5.5rem' }}
                      onError={e => { e.target.src = cardBackImg; }}
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
              <span className="text-white font-black text-xs uppercase tracking-widest">✦ {timingTitle}</span>
              <span className="text-blue-200 text-xs truncate ml-auto">{getName(sourceCard)}</span>
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
            <div className="flex gap-2 px-4 pb-4 pt-1 border-t border-slate-700">
              {ACTIVATE_MAIN_TIMINGS.has(pendingEffect?.timing) && (
                <button
                  onClick={() => { onResolve('CANCEL'); }}
                  className="flex-1 py-3 bg-red-900/60 hover:bg-red-800/60 text-red-200 font-bold text-sm rounded-xl active:scale-95 transition-all"
                >
                  Cancel
                </button>
              )}
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
            <span className="text-blue-200 text-xs truncate ml-auto">{getName(sourceCard)}</span>
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
                      alt={getName(card)}
                      className="w-16 rounded-xl object-cover"
                      style={{ height: '5.5rem' }}
                      onError={e => { e.target.src = cardBackImg; }}
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
            <span className="text-purple-200 text-xs truncate ml-auto">{getName(sourceCard)}</span>
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

  if (choices.type === 'CHOOSE_KEYWORD_TO_GRANT') {
    return (
      <DraggablePanel>
        <div className="bg-slate-900 border border-purple-500/40 overflow-hidden pb-safe">
          <div className="bg-purple-700 px-4 py-2 flex items-center gap-2">
            <span className="text-white font-black text-xs uppercase tracking-widest">⊕ Choose Keyword</span>
            <span className="text-purple-200 text-xs truncate ml-auto">{getName(sourceCard)}</span>
          </div>
          <div className="px-4 pt-3 pb-1">
            <p className="text-white font-black text-sm">Choose one keyword to grant</p>
          </div>
          <div className="px-4 pb-4 flex flex-col gap-2 pt-2">
            {choices.keywords.map((kw, i) => (
              <button
                key={i}
                onClick={() => onResolve([i])}
                className="w-full py-3 px-4 text-left rounded-xl border-2 border-slate-600 bg-slate-800 hover:border-purple-400 hover:bg-purple-900/30 active:scale-95 transition-all"
              >
                <span className="text-white text-sm font-semibold leading-snug">【{kw}】</span>
              </button>
            ))}
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
            <span className="text-purple-200 text-xs truncate ml-auto">{getName(sourceCard)}</span>
          </div>
          <div className="px-4 pt-3 pb-1">
            <p className="text-white font-black text-sm">Select one effect to activate</p>
          </div>
          <div className="px-4 pb-4 flex flex-col gap-2 pt-2">
            {choices.options.map(({ key, label, enLabel }) => (
              <button
                key={key}
                onClick={() => onResolve([key])}
                className="w-full py-3 px-4 text-left rounded-xl border-2 border-slate-600 bg-slate-800 hover:border-purple-400 hover:bg-purple-900/30 active:scale-95 transition-all"
              >
                <span className="text-white text-sm font-semibold leading-snug">{isEn ? (enLabel ?? label) : label}</span>
              </button>
            ))}
          </div>
        </div>
      </DraggablePanel>
    );
  }

  const choiceConfig = buildChoiceConfig(choices, pendingEffect, state, getName);
  if (!choiceConfig) return null;

  if (ACTIVATE_MAIN_TIMINGS.has(pendingEffect?.timing)) choiceConfig.canCancel = true;

  const { title, subtitle, items, maxSelect, canSkip, canCancel } = choiceConfig;

  const previewCard = hoveredCard ?? (
    selected.length === 1 ? (items.find(it => it.key === selected[0])?.card ?? null) : null
  );
  let confirmLabel = choiceConfig.confirmLabel ?? 'Confirm';
  if (choices.type === 'SEARCH_PICK')      confirmLabel = `Take ${selected.length}`;
  if (choices.type === 'CHOOSE_DISCARD_FREE') confirmLabel = selected.length ? `Discard ${selected.length}` : 'Skip';
  if (choices.type === 'CHOOSE_FREE_EVENT')   confirmLabel = selected.length ? `Activate ${selected.length}` : 'Skip';
  if (choices.type === 'CHOOSE_DON_UNREST')   confirmLabel = selected.length ? `Activate ${selected.length}` : 'Skip';
  if (choices.type === 'CHOOSE_OPP_DON_RETURN') confirmLabel = selected.length ? `Return ${selected.length} DON!!` : 'Return';

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
    setPlaceOnTop(true);
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
              : choices.type === 'CHOOSE_ARRANGE_LIFE'
                ? selected.length === choices.lifeCards.length
                : selected.length > 0;

  return (
    <>
      {previewCard && <CardDetailOverlay card={previewCard} x={0} y={0} />}
    <DraggablePanel>
      <div className="bg-slate-900 border border-blue-500/40 overflow-hidden pb-safe">

        <div className="bg-blue-700 px-4 py-2 flex items-center gap-2">
          <span className="text-white font-black text-xs uppercase tracking-widest">✦ {timingTitle}</span>
          <span className="text-blue-200 text-xs truncate ml-auto">{getName(sourceCard)}</span>
        </div>

        <div className="px-4 pt-3 pb-1">
          <p className="text-white font-black text-sm">{title}</p>
          <p className="text-slate-400 text-xs mt-0.5">{subtitle}</p>
        </div>

        {choices.type === 'SEARCH_ORDER' && choices.canPlaceOnTop && (
          <div className="flex gap-2 px-4 pb-2">
            <button
              onClick={() => setPlaceOnTop(true)}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all
                ${placeOnTop ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}
            >
              Deck Top
            </button>
            <button
              onClick={() => setPlaceOnTop(false)}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all
                ${!placeOnTop ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}
            >
              Deck Bottom
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

        {choices.type === 'SEARCH_ORDER' ? (
          <div className="px-4 pb-3 overflow-x-auto">
            <div ref={orderRowRef} className="flex gap-2 pt-2 items-end">
              <span className="text-[10px] text-blue-300 font-bold pb-2 flex-shrink-0">TOP</span>
              {selected.map((key, selIdx) => {
                const item = items.find(it => it.key === key);
                if (!item?.card) return null;
                const isDragging = dragIndex === selIdx;
                const isOver     = overIndex === selIdx && dragIndex !== selIdx;
                return (
                  <div
                    key={key}
                    data-sel-idx={selIdx}
                    draggable
                    onDragStart={e => { setDragIndex(selIdx); setOverIndex(selIdx); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragOver={e => { e.preventDefault(); setOverIndex(selIdx); }}
                    onDrop={e => {
                      e.preventDefault();
                      if (dragIndex !== null && dragIndex !== selIdx) {
                        setSelected(prev => {
                          const arr = [...prev];
                          const [m] = arr.splice(dragIndex, 1);
                          arr.splice(selIdx, 0, m);
                          return arr;
                        });
                      }
                      setDragIndex(null); setOverIndex(null);
                    }}
                    onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
                    onTouchStart={() => { setDragIndex(selIdx); setOverIndex(selIdx); }}
                    onTouchMove={e => {
                      const touch = e.touches[0];
                      if (!orderRowRef.current) return;
                      for (const el of orderRowRef.current.querySelectorAll('[data-sel-idx]')) {
                        const r = el.getBoundingClientRect();
                        if (touch.clientX >= r.left && touch.clientX <= r.right &&
                            touch.clientY >= r.top  && touch.clientY <= r.bottom) {
                          setOverIndex(parseInt(el.dataset.selIdx));
                          break;
                        }
                      }
                    }}
                    onTouchEnd={() => {
                      if (dragIndex !== null && overIndex !== null && dragIndex !== overIndex) {
                        setSelected(prev => {
                          const arr = [...prev];
                          const [m] = arr.splice(dragIndex, 1);
                          arr.splice(overIndex, 0, m);
                          return arr;
                        });
                      }
                      setDragIndex(null); setOverIndex(null);
                    }}
                    style={{ touchAction: 'none' }}
                    className={`relative flex-shrink-0 rounded-xl border-2 cursor-grab active:cursor-grabbing transition-all select-none${isDragging ? ' opacity-40 scale-95 border-slate-500' : isOver ? ' border-yellow-300 scale-105 shadow-lg shadow-yellow-400/30' : ' border-blue-400 shadow-md shadow-blue-500/30'}`}
                  >
                    <img
                      src={getSafeImageUrl(item.card)}
                      alt={getName(item.card)}
                      className="w-16 rounded-xl object-cover pointer-events-none"
                      style={{ height: '5.5rem' }}
                      onError={e => { e.target.src = cardBackImg; }}
                    />
                    <div className="absolute bottom-1 left-0 right-0 flex justify-center">
                      <span className="bg-blue-600/90 text-white text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center">
                        {selIdx + 1}
                      </span>
                    </div>
                  </div>
                );
              })}
              <span className="text-[10px] text-slate-500 font-bold pb-2 flex-shrink-0">BTM</span>
            </div>
          </div>
        ) : (
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
                    onMouseEnter={() => { if (!isIneligible) { onHoverTarget?.(key); if (card) setHoveredCard(card); } }}
                    onMouseLeave={() => { onHoverTarget?.(null); setHoveredCard(null); }}
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
                          alt={getName(card)}
                          className="w-16 rounded-xl object-cover"
                          style={{ height: '5.5rem' }}
                          onError={e => { e.target.src = cardBackImg; }}
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
                    {isSelected && choices.orderMode && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-blue-500/30">
                        <span className="bg-blue-600 text-white text-sm font-black w-7 h-7 rounded-full flex items-center justify-center">
                          {selected.indexOf(key) + 1}
                        </span>
                      </div>
                    )}
                    {isSelected && !choices.orderMode && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-blue-500/20">
                        <span className="text-white text-lg font-black">✓</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

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
    </>
  );
}
