// Core TypeScript types for HockeyPool (Shared between Web, Mobile, and Backend)

export type SubscriptionTier = 'free' | 'admin_basic' | 'admin_top';

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url?: string | null;
  subscription_tier: SubscriptionTier;
  is_super_admin?: boolean;
  created_at: string;
  updated_at: string;
}

export type SeasonType = 'regular' | 'playoffs';
export type DraftStatus = 'setup' | 'active' | 'confirmed' | 'completed';

export interface Season {
  id: string; // e.g. '20262027'
  name: string; // e.g. '2026-2027'
  is_current: boolean;
}

export interface ScoringWeight {
  stat: string;
  enabled: boolean;
  weight: number;
  label: string;
}

export interface Draft {
  id: string;
  admin_id: string;
  season_id: string;
  name: string;
  description?: string | null;
  season_type: SeasonType;
  status: DraftStatus;
  invite_code: string;
  forwards_count: number;
  defense_count: number;
  goalies_count: number;
  injured_reserve_count: number;
  salary_cap_enabled: boolean;
  salary_cap_amount: number; // In millions e.g. 88.0
  current_pick: number;
  max_teams: number;
  created_at: string;
  updated_at: string;
}

export interface DraftTeam {
  id: string;
  draft_id: string;
  user_id: string | null;
  team_name: string;
  draft_order: number;
  owner_name?: string;
  owner_email?: string;
  created_at: string;
  updated_at: string;
}

export type PlayerPosition = 'C' | 'L' | 'R' | 'D' | 'G' | 'F';
export type RosterStatus = 'active' | 'ir';

export interface DraftPick {
  id: string;
  draft_id: string;
  draft_team_id: string;
  pick_number: number;
  nhl_player_id: number;
  player_name: string;
  player_position: PlayerPosition;
  player_team: string;
  roster_status: RosterStatus;
  score_before_current_status: number;
  score_snapshot: Record<string, number>;
  cap_hit: number; // in millions e.g. 9.5
  created_at: string;
}

export type TransactionType = 'ir_swap' | 'trade' | 'waiver';
export type TransactionStatus = 'pending' | 'applied' | 'cancelled';

export interface RosterTransactionPlayer {
  transaction_id: string;
  draft_pick_id: string;
  from_status: RosterStatus;
  to_status: RosterStatus;
  player?: DraftPick;
}

export interface RosterTransaction {
  id: string;
  draft_id: string;
  draft_team_id: string;
  user_id: string | null;
  transaction_type: TransactionType;
  effective_at: string;
  status: TransactionStatus;
  notes?: string | null;
  created_at: string;
  players?: RosterTransactionPlayer[];
}

export interface PlayerSalary {
  season_id: string;
  nhl_player_id: number;
  player_name: string;
  team_abbrev?: string | null;
  position?: string | null;
  cap_hit: number;
  source: 'spotrac' | 'manual' | 'csv' | 'nhl';
  updated_at: string;
}

export interface NHLSkater {
  playerId: number;
  skaterFullName: string;
  positionCode: string; // 'C', 'L', 'R', 'D'
  teamAbbrevs: string;
  gamesPlayed: number;
  goals: number;
  assists: number;
  points: number;
  plusMinus: number;
  penaltyMinutes: number;
  blockedShots: number;
  hits: number;
  shots: number;
  otGoals: number;
  capHit?: number;
}

export interface NHLGoalie {
  playerId: number;
  goalieFullName: string;
  teamAbbrevs: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  otLosses: number;
  shutouts: number;
  shotsAgainst: number;
  goalsAgainst: number;
  goalsAgainstAverage: number;
  savePct: number;
  goals: number;
  assists: number;
  points: number;
  capHit?: number;
}

export interface TeamStanding {
  teamId: string;
  teamName: string;
  ownerName: string;
  totalPoints: number;
  activePlayersCount: number;
  irPlayersCount: number;
  totalCapHit: number;
  rank: number;
}
