// Per-leader AI behaviour overrides. Keeps leader-specific knowledge out of
// the general planning logic so new leaders can be added without touching aiPlayer.js.

const LEADER_PROFILES = {
  // Jewelry Bonney — 【對方攻擊時】【Once Per Turn】➀: Rest 1 opponent Leader/Character.
  // Reserve 1 active DON every turn so the cost can be paid when the human attacks.
  // When no character is played this turn, route spare DON to the leader (8000+ attack)
  // rather than piling onto existing characters.
  'OP07-019': { donReserve: 1, preferLeaderAttach: true },

  // Enel — his engine revolves entirely around OP15-118 (Enel character).
  // Always seek it from search effects regardless of how many copies are already in hand.
  // donAttachToWeakestMatchable: Activate:Main attaches rested DON to the weakest character whose
  // current power + min(N, available rested DON) * 1000 >= opponent leader power, so that character
  // can trade into the opponent leader. Attach only the minimum DON needed to reach the threshold.
  // Fallback to highest-power character if no such character exists.
  'OP15-058': { seekPriority: ['OP15-118'], donAttachToWeakestMatchable: true },

  // Luffy (Sky Island) — leader replacement effect: when a Sky Island 6000+ character
  // would be removed, AI may draw 1 life card instead.
  // Only use protection when life after drawing is still ≥ 3 (so before: life ≥ 4).
  'OP15-098': { minLifeAfterProtect: 3 },

  // Boa Hancock — [DON!! x1] KO-response effect needs 1 DON always attached to leader.
  // Attached DON resets each turn, so re-attach 1 every main phase before spending on characters.
  'OP14-041': { leaderDonGate: 1 },

  // Mihawk — [Activate: Main] rests 1 of own cards as cost.
  // Priority: stage → weak char (non-blocker AND power <5000) → DON → strong char (≥5000).
  'OP14-020': { restCostPriority: true },

  // Kalgara — [When Attacking] deploy 1 Shandian Warrior (cost ≤ DON on field), then draw 1 life card.
  // Only trigger when: (1) remaining life after draw ≥ 1 (i.e. current ≥ 2);
  //                    (2) char cost ≥ totalDon−1 (skip if 2+ below DON — too cheap to burn a life).
  'OP08-098': { lifeDeployGate: { minLifeAfter: 1, minCostOffset: -1 } },

  // Luffy (OP11-040) — start-of-turn search (8+ DON) seeks OP06-119 (Sanji).
  // Sanji's on-play reveals top deck and deploys up to 1 cost-9 character for free.
  // Always seek Sanji first; always play Sanji before any other character.
  'OP11-040': { seekPriority: ['OP06-119'], cardPlayPriority: ['OP06-119'] },

  // Koby (OP11-001) — SWORD chars get rushCharOnly on deploy (handled by leaderHasRushCharsPassive);
  // EB03-008 (Hibari) lets a SWORD card attack active chars — seek and play it first.
  'OP11-001': { seekPriority: ['EB03-008'], cardPlayPriority: ['EB03-008'] },

  // Jewelry Bonney (EB04-001) — Activate:Main gives −1000 to opponent char, then draws 1 life
  // (when life ≥ 2). Goal: reach 1 life by 9-DON turn for EB04-061 cost reduction.
  // alwaysActivateMain bypasses activationHasBenefit so the debuff fires even at life = 1.
  // seekPriority + cardPlayPriority ensure EB04-061 (Luffy) is fetched and played first.
  'EB04-001': { alwaysActivateMain: true, seekPriority: ['EB04-061'], cardPlayPriority: ['EB04-061'] },

  // Ace (OP13-002) — play ST22-015 (cost 8 event) to deploy OP13-042 (Whitebeard, cost 10) for
  // free. OP13-042 on-play: draw 2 / discard 1 / attach 2 rested DON to leader + character.
  // eventPlayConditions gate ensures ST22-015 is not wasted when OP13-042 is not in hand.
  // noSelfLifeBoost skips ST22-015's optional life-take (leader +2000) unless AI will die next
  // turn — preserving life cards for OP13-002's DON!! x1 draw trigger.
  'OP13-002': {
    seekPriority: ['ST22-015'],
    eventPlayPriority: ['ST22-015'],
    eventPlayConditions: { 'ST22-015': { requiredHandCard: 'OP13-042' } },
    noSelfLifeBoost: ['ST22-015'],
  },

  // Zoro (OP12-020) — Activate:Main sets attackCostRestriction (cannot attack cost≤7 chars) and
  // flags the leader for re-activation after it attacks a character.
  // Strategy: attach 3 DON to leader (8000 power), activate, attack an opponent character (cost≥8),
  // re-activate, attack opponent leader. If OP12-039 in hand, play it to re-activate again and
  // attack the leader a third time.
  'OP12-020': {
    leaderDonGate: 3,
    leaderReactivateOnCharBattle: true,
    postAttackEventPlay: ['OP12-039'],
  },

  // Luffy (OP13-001) — [DON!! x1] [On Opponent's Attack]: if ≤5 active DON remain,
  // rest any number of own DON for +2000 power each (to leader or a Straw Hat char).
  // leaderDonGate: keep 1 DON attached to the leader every turn to enable the trigger.
  // donReserve: hold 1 extra active DON in cost area as a defensive trigger reserve.
  // cardPlayPriority: play DON-reactivating characters first to keep the trigger battery full.
  //   OP13-027 (Sanji) — On Play: set 2 active; End of Turn: set 1 active
  //   OP13-037 (Zoro)  — On Play: set 2 active (if Straw Hat Crew leader)
  //   P-102    (Nami)  — On Play: set 2 active (if Straw Hat Crew leader)
  //   OP14-022 (Usopp) — End of Turn: set 2 active (if Straw Hat Crew/FILM leader)
  //   OP13-030 (Chopper) — On Play: set 2 active
  //   OP13-034 (Brook) — On Play: set 1 active (if Straw Hat Crew/FILM leader)
  'OP13-001': {
    leaderDonGate: 1,
    donReserve: 1,
    cardPlayPriority: ['OP13-027', 'OP13-037', 'P-102', 'OP14-022', 'OP13-030', 'OP13-034'],
  },

  // Yamato (OP16-079) — leader passive: Land of Wano chars deployed FROM TRASH gain Rush this turn.
  //
  // Turn 6-DON: play OP16-098 (Yamato char) from hand — draws 1, discards 1 (mills trash).
  // Turn 8-DON (next): after OP16-098 attacks (rested), activate its Main → trash self → deploy
  //   cost-8 black Yamato (OP16-097 or OP16-096) from trash with Rush → attack.
  // Turn 9-DON: play OP16-084 (Momonosuke cost-5) first, then OP16-087 (Shinobu cost-2) →
  //   on-play: Shinobu self-trashes → Momonosuke gains +20 cost (now 25) + draw 1.
  //   Second activateMainAbilities call (post-deploy) fires OP16-084's Main:
  //   cost-20+ self-trash → deploy OP16-085 (Momo cost-9) from trash → on-play deploys
  //   OP16-098 from trash (Rush via leader) → OP16-098 attacks → post-attack activates
  //   OP16-098's Main → deploy OP16-097/096 with Rush → attacks.
  //
  // charActivationsMinCost: enforce OP16-084's "cost ≥ 20" self-trash prerequisite.
  // trashDeployPriority: when AI resolves CHOOSE_DEPLOY_FROM_TRASH, pick in this order.
  'OP16-079': {
    seekPriority:             ['OP16-084', 'OP16-087', 'OP16-098', 'OP16-085', 'OP16-097', 'OP16-096'],
    cardPlayPriority:         ['OP16-084', 'OP16-087', 'OP16-098'],
    cardPlayConditions:       { 'OP16-084': { minTotalDon: 9 }, 'OP16-087': { minTotalDon: 9 } },
    charActivationsMinCost:   { 'OP16-084': 20 },
    postAttackCharActivations:['OP16-098'],
    trashDeployPriority:      ['OP16-085', 'OP16-098', 'OP16-097', 'OP16-096'],
  },

  // Shanks (OP09-001) — OP16-012 (Benn Beckman) has [On Play]: rest 1 DON → free-deploy a [Shanks]
  // from hand, but ONLY if total DON on field is exactly 10. Deploying Beckman earlier wastes the
  // free Shanks trigger. Hold him until 10 DON so Beckman + Shanks land together in one turn.
  // seekPriority: fetch Beckman first, then the three Shanks targets (ST23-002, OP09-004, OP06-007)
  // so the hand is stocked for the 10-DON turn.
  'OP09-001': {
    seekPriority: ['OP16-012', 'ST23-002', 'OP09-004', 'OP06-007'],
    cardPlayConditions: { 'OP16-012': { minTotalDon: 10 } },
  },

  // Uta (OP09-002) — same Red-Haired Pirates engine; seek the same four-card combo package.
  'OP09-002': {
    seekPriority: ['OP16-012', 'ST23-002', 'OP09-004', 'OP06-007'],
  },

  // Sengoku (OP16-060) — [Activate: Main] return 8 active DON!! to deploy up to 3 Admirals
  // from hand with different names. Strategy:
  //   1. Seek OP16-063/065/073 (the three admirals) via search effects before anything else.
  //   2. Prefer OP16-066 / OP16-075 as early plays (ramp characters at 5-6 DON turns).
  //   3. Only fire the leader activation once all 3 admirals are in hand (leaderActivationRequiresHand).
  //      Until then, spend DON normally on ramp/utility characters.
  'OP16-060': {
    seekPriority: ['OP16-063', 'OP16-065', 'OP16-073'],
    cardPlayPriority: ['OP16-066', 'OP16-075'],
    leaderActivationRequiresHand: { ids: ['OP16-063', 'OP16-065', 'OP16-073'], minCount: 3 },
  },
};

export function getLeaderProfile(leaderId) {
  const base = leaderId?.replace(/_p\d+$/, '').replace(/_r$/, '');
  return LEADER_PROFILES[base] ?? null;
}
