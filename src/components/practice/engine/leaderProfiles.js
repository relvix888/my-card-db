// Per-leader AI behaviour overrides. Keeps leader-specific knowledge out of
// the general planning logic so new leaders can be added without touching aiPlayer.js.

const LEADER_PROFILES = {
  // Jewelry Bonney — 【對方攻擊時】【Once Per Turn】➀: Rest 1 opponent Leader/Character.
  // Reserve 1 active DON every turn so the cost can be paid when the human attacks.
  // When no character is played this turn, route spare DON to the leader (8000+ attack)
  // rather than piling onto existing characters.
  'OP07-019': { donReserve: 1, preferLeaderAttach: true },
};

export function getLeaderProfile(leaderId) {
  const base = leaderId?.replace(/_p\d+$/, '').replace(/_r$/, '');
  return LEADER_PROFILES[base] ?? null;
}
