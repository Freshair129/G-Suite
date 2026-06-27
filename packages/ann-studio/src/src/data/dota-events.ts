export interface DotaEvent {
  id: string;
  label: string;
  category: string;
}

export const DOTA_EVENTS: DotaEvent[] = [
  // Kill streaks
  { id: "first_blood",   label: "First Blood",      category: "Kills" },
  { id: "double_kill",   label: "Double Kill",       category: "Kills" },
  { id: "triple_kill",   label: "Triple Kill",       category: "Kills" },
  { id: "ultra_kill",    label: "Ultra Kill",        category: "Kills" },
  { id: "rampage",       label: "Rampage",           category: "Kills" },
  { id: "killing_spree", label: "Killing Spree",     category: "Kills" },
  { id: "dominating",    label: "Dominating",        category: "Kills" },
  { id: "mega_kill",     label: "Mega Kill",         category: "Kills" },
  { id: "unstoppable",   label: "Unstoppable",       category: "Kills" },
  { id: "wicked_sick",   label: "Wicked Sick",       category: "Kills" },
  { id: "monster_kill",  label: "Monster Kill",      category: "Kills" },
  { id: "godlike",       label: "Godlike",           category: "Kills" },
  { id: "beyond_godlike", label: "Beyond Godlike",   category: "Kills" },

  // Match flow
  { id: "match_start",   label: "Match Start",       category: "Match" },
  { id: "match_end_win", label: "Victory",           category: "Match" },
  { id: "match_end_lose", label: "Defeat",           category: "Match" },
  { id: "battle_begin",  label: "Battle Begin",      category: "Match" },
  { id: "ten_min",       label: "10 Minute Mark",    category: "Match" },

  // Buildings
  { id: "tower_attack_ally",    label: "Tower Under Attack (Ally)",  category: "Buildings" },
  { id: "tower_attack_enemy",   label: "Tower Under Attack (Enemy)", category: "Buildings" },
  { id: "tower_destroy_ally",   label: "Tower Destroyed (Ally)",     category: "Buildings" },
  { id: "tower_destroy_enemy",  label: "Tower Destroyed (Enemy)",    category: "Buildings" },
  { id: "barracks_destroy_ally",  label: "Barracks Destroyed (Ally)",   category: "Buildings" },
  { id: "barracks_destroy_enemy", label: "Barracks Destroyed (Enemy)",  category: "Buildings" },
  { id: "mega_creeps",          label: "Mega Creeps",                category: "Buildings" },

  // Team fights
  { id: "annihilation",  label: "Annihilation (Ace)", category: "Team Fight" },
  { id: "team_wipe",     label: "Team Wipe",          category: "Team Fight" },
  { id: "buyback",       label: "Buyback",             category: "Team Fight" },

  // Objectives
  { id: "roshan_killed",  label: "Roshan Killed",     category: "Objectives" },
  { id: "aegis_picked",   label: "Aegis Picked Up",   category: "Objectives" },
  { id: "aegis_stolen",   label: "Aegis Stolen",      category: "Objectives" },
  { id: "courier_killed", label: "Courier Killed",    category: "Objectives" },
  { id: "scan_used",      label: "Scan Used",         category: "Objectives" },

  // General
  { id: "taunt",          label: "Taunt / Trash Talk",  category: "General" },
  { id: "compliment",     label: "Compliment",          category: "General" },
  { id: "warning",        label: "Warning / Alert",     category: "General" },
  { id: "encourage",      label: "Encourage",           category: "General" },
  { id: "custom",         label: "Custom",              category: "General" },
];

export const EVENT_CATEGORIES = [...new Set(DOTA_EVENTS.map(e => e.category))];
