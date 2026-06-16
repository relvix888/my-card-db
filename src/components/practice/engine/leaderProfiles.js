// Per-leader AI behaviour overrides. Keeps leader-specific knowledge out of
// the general planning logic so new leaders can be added without touching aiPlayer.js.

const LEADER_PROFILES = {
  // Jewelry Bonney — 【對方攻擊時】【Once Per Turn】➀: Rest 1 opponent Leader/Character.
  // Reserve 1 active DON every turn so the cost can be paid when the human attacks.
  // When no character is played this turn, route spare DON to the leader (8000+ attack)
  // rather than piling onto existing characters.
  "OP07-019": { donReserve: 1, preferLeaderAttach: true },

  // Enel — his engine revolves entirely around OP15-118 (Enel character).
  // Always seek it from search effects regardless of how many copies are already in hand.
  // donAttachToWeakestMatchable: Activate:Main attaches rested DON to the weakest character whose
  // current power + min(N, available rested DON) * 1000 >= opponent leader power, so that character
  // can trade into the opponent leader. Attach only the minimum DON needed to reach the threshold.
  // Fallback to highest-power character if no such character exists.
  "OP15-058": { seekPriority: ["OP15-118"], donAttachToWeakestMatchable: true },

  // Luffy (Sky Island) — leader replacement effect: when a Sky Island 6000+ character
  // would be removed, AI may draw 1 life card instead.
  // Only use protection when life after drawing is still ≥ 3 (so before: life ≥ 4).
  "OP15-098": { minLifeAfterProtect: 3 },

  // Boa Hancock — [DON!! x1] KO-response effect needs 1 DON always attached to leader.
  // Attached DON resets each turn, so re-attach 1 every main phase before spending on characters.
  "OP14-041": { leaderDonGate: 1 },

  // Mihawk — [Activate: Main] rests 1 of own cards as cost; if a cost-5+ Character is on
  // field, re-stands up to 3 DON!!, then forbids playing Characters for the rest of the turn.
  // Priority for the rest-cost: stage → weak char (non-blocker AND power <5000) → DON → strong char (≥5000).
  //
  // Two AI rules so the deploy-lock never wastes a turn:
  //   activateMainAfterDeploy      — defer the activation until every affordable Character has been
  //                                  played, so the "cannot play Characters" rider never cancels a plan.
  //   saveLeaderAttackForActivation — hold the leader's attack until after the activation, so the
  //                                  re-activated DON can be attached to the leader's swing.
  "OP14-020": {
    restCostPriority: true,
    activateMainAfterDeploy: true,
    saveLeaderAttackForActivation: true,
    // Only re-stands DON when a cost-5+ Character is on field; skip the activation otherwise
    // so the leader isn't rested for no payoff.
    leaderActivationRequiresFieldCharCost: 5,
  },

  // Kalgara — [When Attacking] deploy 1 Shandian Warrior (cost ≤ DON on field), then draw 1 life card.
  // Only trigger when: (1) remaining life after draw ≥ 1 (i.e. current ≥ 2);
  //                    (2) char cost ≥ totalDon−1 (skip if 2+ below DON — too cheap to burn a life).
  "OP08-098": { lifeDeployGate: { minLifeAfter: 1, minCostOffset: -1 } },

  // Luffy (OP11-040) — start-of-turn search (8+ DON) seeks OP06-119 (Sanji).
  // Sanji's on-play reveals top deck and deploys up to 1 cost-9 character for free.
  // Always seek Sanji first; always play Sanji before any other character.
  "OP11-040": { seekPriority: ["OP06-119"], cardPlayPriority: ["OP06-119"] },

  // Koby (OP11-001) — SWORD chars get rushCharOnly on deploy (handled by leaderHasRushCharsPassive);
  // EB03-008 (Hibari) lets a SWORD card attack active chars — seek and play it first.
  "OP11-001": { seekPriority: ["EB03-008"], cardPlayPriority: ["EB03-008"] },

  // Jewelry Bonney (EB04-001) — Activate:Main gives −1000 to opponent char, then draws 1 life
  // (when life ≥ 2). Goal: reach 1 life by 9-DON turn for EB04-061 cost reduction.
  // alwaysActivateMain bypasses activationHasBenefit so the debuff fires even at life = 1.
  // seekPriority + cardPlayPriority ensure EB04-061 (Luffy) is fetched and played first.
  "EB04-001": {
    alwaysActivateMain: true,
    seekPriority: ["EB04-061"],
    cardPlayPriority: ["EB04-061"],
  },

  // Ace (OP13-002) — play ST22-015 (cost 8 event) to deploy OP13-042 (Whitebeard, cost 10) for
  // free. OP13-042 on-play: draw 2 / discard 1 / attach 2 rested DON to leader + character.
  // eventPlayConditions gate ensures ST22-015 is not wasted when OP13-042 is not in hand.
  // noSelfLifeBoost skips ST22-015's optional life-take (leader +2000) unless AI will die next
  // turn — preserving life cards for OP13-002's DON!! x1 draw trigger.
  "OP13-002": {
    seekPriority: ["ST22-015"],
    eventPlayPriority: ["ST22-015"],
    eventPlayConditions: { "ST22-015": { requiredHandCard: "OP13-042" } },
    noSelfLifeBoost: ["ST22-015"],
  },

  // Zoro (OP12-020) — Activate:Main sets attackCostRestriction (cannot attack cost≤7 chars) and
  // flags the leader for re-activation after it attacks a character.
  // Strategy: attach 3 DON to leader (8000 power), activate, attack an opponent character (cost≥8),
  // re-activate, attack opponent leader. If OP12-039 in hand, play it to re-activate again and
  // attack the leader a third time.
  "OP12-020": {
    leaderDonGate: 3,
    leaderReactivateOnCharBattle: true,
    postAttackEventPlay: ["OP12-039"],
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
  "OP13-001": {
    leaderDonGate: 1,
    donReserve: 1,
    cardPlayPriority: [
      "OP13-027",
      "OP13-037",
      "P-102",
      "OP14-022",
      "OP13-030",
      "OP13-034",
    ],
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
  "OP16-079": {
    seekPriority: [
      "OP16-084",
      "OP16-087",
      "OP16-098",
      "OP16-085",
      "OP16-097",
      "OP16-096",
    ],
    cardPlayPriority: ["OP16-084", "OP16-087", "OP16-098"],
    cardPlayConditions: {
      "OP16-084": { minTotalDon: 9 },
      "OP16-087": { minTotalDon: 9, requiredOnField: "OP16-084" },
    },
    charActivationsMinCost: { "OP16-084": 20 },
    postAttackCharActivations: ["OP16-098"],
    trashDeployPriority: ["OP16-085", "OP16-098", "OP16-097", "OP16-096"],
  },

  // Shanks (OP09-001) — OP16-012 (Benn Beckman) has [On Play]: rest 1 DON → free-deploy a [Shanks]
  // from hand, but ONLY if total DON on field is exactly 10. Deploying Beckman earlier wastes the
  // free Shanks trigger. Hold him until 10 DON so Beckman + Shanks land together in one turn.
  // seekPriority: fetch Beckman first, then the three Shanks targets (ST23-002, OP09-004, OP06-007)
  // so the hand is stocked for the 10-DON turn.
  "OP09-001": {
    seekPriority: ["OP16-012", "ST23-002", "OP09-004", "OP06-007"],
    cardPlayConditions: { "OP16-012": { minTotalDon: 10 } },
  },

  // Uta (OP09-002) — same Red-Haired Pirates engine; seek the same four-card combo package.
  "OP09-002": {
    seekPriority: ["OP16-012", "ST23-002", "OP09-004", "OP06-007"],
  },

  // Luffy (OP16-022) — leader effect activates 2 DON, enabling multi-card turns with cheap bodies.
  // Early turns: spam OP16-034 (cost 1), OP16-054 (cost 2), OP16-055 (cost 2).
  // 5–6 DON turn: prioritise OP16-048 (cost 5, Buggy).
  // 7–8 DON turn: prioritise OP16-032 (cost 7, Boa Hancock).
  // charDonAttach1: always pre-allocate 1 DON to these chars when they attack — their
  //   DON!! ×1 effects bring power to 5000–6000 (OP16-054: +3000 if hand ≥ 5;
  //   OP16-055: matches opponent leader power; OP16-034: +1000 per unique char on field).
  "OP16-022": {
    cardPlayPriority: [
      "OP16-032",
      "OP16-048",
      "OP16-034",
      "OP16-054",
      "OP16-055",
    ],
    cardPlayConditions: {
      "OP16-032": { minTotalDon: 7 },
      "OP16-048": { minTotalDon: 5 },
    },
    charDonAttach1: ["OP16-034", "OP16-054", "OP16-055"],
  },

  // Portgas.D.Ace (OP16-001) — [Activate: Main] [Once Per Turn]: up to 1 own [Monkey.D.Luffy]
  // or {Whitebeard Pirates} char with 8000+ power gains [Rush] this turn.
  // Strategy: seek OP16-003 (Edward.Newgate cost-8 / 10000 power, [Your Turn] leader +2000 /
  // Double Attack) and play it as soon as 8 DON are available.  Deploy OP16-003 BEFORE the
  // leader activation so it is the highest-power justDeployed eligible target for the Rush grant.
  // rushGrantJustDeployedOnly: skip activation when no justDeployed char is on field — giving
  // Rush to a pre-existing character is pointless since they can already attack.
  "OP16-001": {
    seekPriority: ["OP16-003"],
    cardPlayPriority: ["OP16-003"],
    cardPlayConditions: { "OP16-003": { minTotalDon: 8 } },
    deployPriorityBeforeActivation: true,
    rushGrantJustDeployedOnly: true,
  },

  // Sengoku (OP16-060) — [Activate: Main] return 8 active DON!! to deploy up to 3 Admirals
  // from hand with different names. Strategy:
  //   1. Seek OP16-063/065/073 (the three admirals) via search effects before anything else.
  //   2. Prefer OP16-066 / OP16-075 as early plays (ramp characters at 5-6 DON turns).
  //   3. Fire the leader activation once 2+ unique-named Admiral characters are in hand — a
  //      single Admiral costs 7 DON to play normally, so spending 8 DON to deploy just one is
  //      not worth resting the leader. With 2+ unique Admirals the activation is a clear gain,
  //      and subsequent 10-DON turns (8 returned + 2 gained) keep the condition re-evaluatable.
  //      activationHasBenefit guards the zero-target edge case.
  "OP16-060": {
    seekPriority: ["OP16-063", "OP16-065", "OP16-073"],
    cardPlayPriority: ["OP16-066", "OP16-075"],
    leaderActivationMinUniqueAdmirals: 2,
    // Existing characters should attack before the leader activation rests the leader
    // and burns 8 DON — otherwise they lose their attack opportunity post-activation.
    charAttacksBeforeLeaderActivation: true,
  },

  // Donquixote Rosinante (OP12-061) — [Activate: Main] DON!! -1: next [Trafalgar Law]
  // (cost ≥ 4) played this turn costs -2.
  //
  // Game plan: every turn, activate the leader's Main (sets the -2 Law discount) BEFORE
  // playing anything, then play out a [Trafalgar Law] character at the reduced cost:
  //   P-093    (cost 4, Blocker / DON!! ramp)
  //   EB04-038 (cost 4, Blocker / draw + DON!! ramp — also counts as Law & Rosinante)
  //   OP16-068 (cost 4, DON!! ramp + Donquixote Pirates attack buff)
  //   ST10-010 (cost 4, Blocker) — only worth playing when the opponent holds 7+ cards,
  //            since its [On Play] (trash 2 from opponent's hand) only fires then.
  //            minOpponentHand gates the deploy until that condition is met.
  // activateBeforeStage: run activateMainAbilities before playStageIfAvailable so the
  //   discount is set before DON is spent (e.g. 3-DON turn: activate 3→2, play Law 4-2=2 → 0).
  //
  // From the 7-DON turn onward the finisher OP16-065 (Sakazuki, cost 7) takes priority:
  //   [On Play] DON!! -1 gives an opponent Character -6000. minTotalDon: 7 keeps it gated
  //   out of earlier turns so the Law curve runs first.
  "OP12-061": {
    activateBeforeStage: true,
    seekPriority: ["OP16-065", "P-093", "EB04-038", "OP16-068", "ST10-010"],
    cardPlayPriority: ["OP16-065", "P-093", "EB04-038", "OP16-068", "ST10-010"],
    cardPlayConditions: {
      "OP16-065": { minTotalDon: 7 },
      "ST10-010": { minOpponentHand: 7 },
    },
  },

  // Krieg (OP15-001) — Opponent Turn Passive: if only East Blue chars on field and ≥1 DON on
  // leader, give all opponent chars −2000 power. Activate Main (1/Turn): rest up to 1 opponent
  // char with ≥2 attached DON.
  //
  // Curve: Turn 2 → OP15-038 search event. Turn 4 → Arlong (OP15-023).
  //         Turn 6 → Gin (OP15-007, on-play deploys Morgan/Pearl).
  //         Turn 7 → Kuro (OP15-025, freeze/stun). Turn 8 → Krieg char (OP15-008, board wipe).
  // Koby (OP15-009, cost 1) is held in hand as a 2K counter — not in cardPlayPriority.
  "OP15-001": {
    seekPriority: [
      "OP15-007", // Gin (cost 6, on-play deploy engine)
      "OP15-017", // Morgan (cost 5, mid-curve blocker / dawn shuffler)
      "OP15-008", // Krieg character (cost 8, board wipe)
      "OP15-025", // Kuro (cost 7, freeze / stun)
      "OP15-023", // Arlong (cost 4, early shuffler)
      "OP15-026", // Jango (cost 1, searcher)
      "OP15-011", // Pearl (cost 4, defensive roadblock)
      "OP15-038", // "It's an Order! Do Not Defy Me!!!" (cost 1, search event)
    ],
    cardPlayPriority: [
      "OP15-038", // search event (early consistency)
      "OP15-026", // Jango (turn 1/2)
      "OP15-023", // Arlong (turn 4)
      "OP15-011", // Pearl (defensive blocker)
      "OP15-007", // Gin (turn 6, deploy engine)
      "OP15-025", // Kuro (turn 7, stun)
      "OP15-008", // Krieg character (turn 8 finisher)
    ],
    cardPlayConditions: {
      "OP15-023": { minTotalDon: 4 },
      "OP15-007": { minTotalDon: 6 },
      "OP15-025": { minTotalDon: 7 },
      "OP15-008": { minTotalDon: 8 },
    },
  },
};

export function getLeaderProfile(leaderId) {
  const base = leaderId?.replace(/_p\d+$/, "").replace(/_r$/, "");
  return LEADER_PROFILES[base] ?? null;
}
