// ============================================================
// Mock user database for personnel assignment
// ============================================================

export interface User {
  id: string;
  name: string;
  rank: string;
  initials: string;
  role: string;
  nation: string;
  directorate: string;
  color: string;
}

export const USERS: User[] = [
  { id: "u1",  name: "Col Anderssen",     rank: "Colonel",            initials: "AL", role: "EXDIR Deputy",         nation: "NOR", directorate: "HQ",   color: "#6c5ce7" },
  { id: "u2",  name: "BGen Hartmann",     rank: "Brigadier General",  initials: "BG", role: "EXDIR",                nation: "DEU", directorate: "HQ",   color: "#4c7ef3" },
  { id: "u3",  name: "LtCol Kowalski",    rank: "Lieutenant Colonel", initials: "MK", role: "Scenario Lead",        nation: "POL", directorate: "J5",   color: "#f0a83c" },
  { id: "u4",  name: "Maj Westergaard",   rank: "Major",              initials: "TW", role: "PMESII Lead",          nation: "NOR", directorate: "J2",   color: "#ef4d4d" },
  { id: "u5",  name: "Maj Roos",          rank: "Major",              initials: "JR", role: "ORBAT Lead",           nation: "NLD", directorate: "J3",   color: "#98a1c0" },
  { id: "u6",  name: "Maj Hbook",         rank: "Major",              initials: "MH", role: "Geography Lead",       nation: "GBR", directorate: "J2",   color: "#6a7292" },
  { id: "u7",  name: "Capt de Vries",     rank: "Captain",            initials: "CV", role: "MEL Writer",           nation: "NLD", directorate: "J3",   color: "#c47af5" },
  { id: "u8",  name: "Capt Müller",       rank: "Captain",            initials: "CM", role: "Simulation Engineer",  nation: "DEU", directorate: "J6",   color: "#6c5ce7" },
  { id: "u9",  name: "Lt Johansson",      rank: "Lieutenant",         initials: "LJ", role: "Training Analyst",     nation: "NOR", directorate: "J7",   color: "#f0a83c" },
  { id: "u10", name: "WO2 Kowalczyk",     rank: "Warrant Officer",    initials: "WK", role: "Comms Lead",           nation: "POL", directorate: "J6",   color: "#4c7ef3" },
  { id: "u11", name: "Maj Thompson",      rank: "Major",              initials: "MT", role: "Fires Planner",        nation: "GBR", directorate: "J3",   color: "#ef4d4d" },
  { id: "u12", name: "Capt Larsen",       rank: "Captain",            initials: "CL", role: "Intelligence Analyst", nation: "NOR", directorate: "J2",   color: "#6c5ce7" },
  { id: "u13", name: "Lt Col Brandt",     rank: "Lieutenant Colonel", initials: "LB", role: "Logistics Lead",       nation: "DEU", directorate: "J4",   color: "#f0a83c" },
  { id: "u14", name: "Maj Visser",        rank: "Major",              initials: "MV", role: "Engineer Lead",        nation: "NLD", directorate: "J5",   color: "#98a1c0" },
  { id: "u15", name: "Capt Williams",     rank: "Captain",            initials: "CW", role: "CIMIC Officer",        nation: "GBR", directorate: "J9",   color: "#c47af5" },
];

/** Search users by name, rank, role, nation, or directorate */
export function searchUsers(query: string): User[] {
  if (!query.trim()) return USERS;
  const q = query.toLowerCase();
  return USERS.filter(
    (u) =>
      u.name.toLowerCase().includes(q) ||
      u.rank.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q) ||
      u.nation.toLowerCase().includes(q) ||
      u.directorate.toLowerCase().includes(q),
  );
}
