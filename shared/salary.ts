// Resilient Salary Management Engine for HockeyPool
// Fixes the 100-player limitation with multi-page support, fuzzy matching, CSV imports, and fallbacks.

export interface SalaryEntry {
  name: string;
  capHit: number; // In millions e.g. 9.75
  teamAbbrev?: string;
  position?: string;
}

export interface MatchResult {
  playerId: number;
  playerName: string;
  sourceName: string;
  capHit: number;
  confidence: 'exact' | 'fuzzy';
  fuzzyScore?: number;
}

export interface UnmatchedEntry {
  sourceName: string;
  capHit: number;
  bestMatch?: { playerId: number; playerName: string; score: number };
}

export interface SalaryImportResult {
  matched: MatchResult[];
  unmatched: UnmatchedEntry[];
  totalParsed: number;
}

const NICKNAMES: Record<string, string> = {
  matt: 'matthew', tom: 'thomas', tommy: 'thomas', josh: 'joshua', alex: 'alexander',
  alexandre: 'alexander', nick: 'nicholas', mike: 'michael', mikey: 'michael', mitch: 'mitchell',
  cam: 'cameron', tony: 'anthony', zach: 'zachary', dan: 'daniel', freddy: 'frederick',
  fred: 'frederick', gabe: 'gabriel', ben: 'benjamin', teddy: 'theodore', ted: 'theodore',
  jake: 'jacob', joe: 'joseph', joey: 'joseph', jon: 'jonathan', jj: 'jj', max: 'maxim',
  maksim: 'maxim', jeff: 'jeffrey', ryan: 'ryan', ethan: 'ethen', sam: 'samuel', will: 'william',
  willy: 'william', alexei: 'alexey', aleksei: 'alexey', fedor: 'fyodor', egor: 'yegor',
  chris: 'christopher', nate: 'nathan', pat: 'patrick', pj: 'pj', jt: 'jt', cal: 'calvin',
  vince: 'vincent', steve: 'steven', stephen: 'steven', jack: 'john', johnny: 'john',
  nikita: 'nikita', danny: 'daniel', andy: 'andrew', drew: 'andrew', rob: 'robert',
  bobby: 'robert', brad: 'bradley', jim: 'james', jimmy: 'james', ollie: 'oliver',
  charlie: 'charles', phil: 'philipp', philip: 'philipp', phillip: 'philipp',
};

export function normalizeName(name: string): string {
  const cleaned = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents (e.g. Stützle -> Stutzle)
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')      // strip "(AJ)" style nicknames
    .replace(/['\.]/g, '')           // strip apostrophes, periods
    .replace(/[\-]/g, ' ')           // hyphens act as separators
    .replace(/\s+/g, ' ')
    .trim();
  const parts = cleaned.split(' ').filter((p) => !['jr', 'sr', 'ii', 'iii', 'iv'].includes(p));
  if (parts.length > 0) parts[0] = NICKNAMES[parts[0]] ?? parts[0];
  return parts.join(' ');
}

function lastNameKey(name: string): string {
  const parts = normalizeName(name).split(' ');
  return parts[parts.length - 1];
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}

export function nameSimilarity(a: string, b: string): number {
  const normA = normalizeName(a);
  const normB = normalizeName(b);
  if (normA === normB) return 1.0;
  const maxLen = Math.max(normA.length, normB.length);
  if (maxLen === 0) return 1.0;
  return 1 - levenshtein(normA, normB) / maxLen;
}

/**
 * Parses Spotrac contract HTML rows
 */
export function parseSpotracHTML(html: string): SalaryEntry[] {
  const entries: SalaryEntry[] = [];
  const tbodyStart = html.indexOf('<tbody>');
  const tbodyEnd = html.indexOf('</tbody>');
  if (tbodyStart === -1 || tbodyEnd === -1) return entries;
  const tbody = html.substring(tbodyStart + 7, tbodyEnd);

  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(tbody)) !== null) {
    const row = rowMatch[1];
    const tds: string[] = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let tdMatch: RegExpExecArray | null;
    while ((tdMatch = tdRe.exec(row)) !== null) {
      tds.push(tdMatch[1].trim());
    }
    if (tds.length < 9) continue;

    // Player name in <a ...>Name</a>
    const nameMatch = tds[0].match(/>([^<]+)<\/a>/);
    if (!nameMatch) continue;
    const name = nameMatch[1].trim();
    if (!name.includes(' ')) continue;

    // Position in td[1]
    const posMatch = tds[1].replace(/<[^>]+>/g, '').trim();

    // Team abbrev in td[2]
    const teamMatch = tds[2].match(/<span[^>]*class="[^"]*d-none[^"]*"[^>]*>([A-Z]+)<\/span>/) ||
                      tds[2].match(/>([A-Z]{2,3})</);
    const teamAbbrev = teamMatch ? teamMatch[1] : undefined;

    // Cap hit / AAV in td[8]
    const capHitRaw = tds[8].replace(/[$,\s]/g, '');
    const capHit = parseInt(capHitRaw, 10) / 1_000_000;

    if (capHit > 0 && capHit < 25) {
      entries.push({
        name,
        capHit: Math.round(capHit * 100) / 100,
        teamAbbrev,
        position: posMatch || undefined,
      });
    }
  }

  return entries;
}

/**
 * Parses a CSV string containing player salary data (e.g. from PuckPedia or CapFriendly/admin export)
 * Supported header formats: Name, Cap Hit / Salary, Team, Position
 */
export function parseSalaryCSV(csvContent: string): SalaryEntry[] {
  const lines = csvContent.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/["']/g, ''));
  const nameIdx = headers.findIndex((h) => h.includes('player') || h.includes('name'));
  const capIdx = headers.findIndex((h) => h.includes('cap') || h.includes('aav') || h.includes('salary') || h.includes('hit'));
  const teamIdx = headers.findIndex((h) => h.includes('team'));
  const posIdx = headers.findIndex((h) => h.includes('pos'));

  if (nameIdx === -1 || capIdx === -1) {
    throw new Error('CSV must contain at least "Player" and "Cap Hit" (or "Salary") columns.');
  }

  const entries: SalaryEntry[] = [];

  for (let i = 1; i < lines.length; i++) {
    // Parse CSV line taking quotes into account
    const row: string[] = [];
    let inQuotes = false;
    let current = '';

    for (const char of lines[i]) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        row.push(current.trim().replace(/^"|"$/g, ''));
        current = '';
      } else {
        current += char;
      }
    }
    row.push(current.trim().replace(/^"|"$/g, ''));

    const name = row[nameIdx];
    const capRaw = row[capIdx]?.replace(/[$,\s]/g, '') || '0';
    let capHit = parseFloat(capRaw);

    // If cap hit is given in full dollars (e.g. 9500000), convert to millions
    if (capHit > 1000) {
      capHit = capHit / 1_000_000;
    }

    if (name && !isNaN(capHit) && capHit > 0) {
      entries.push({
        name,
        capHit: Math.round(capHit * 100) / 100,
        teamAbbrev: teamIdx !== -1 ? row[teamIdx] : undefined,
        position: posIdx !== -1 ? row[posIdx] : undefined,
      });
    }
  }

  return entries;
}

const SPOTRAC_RANKINGS_BASE = 'https://www.spotrac.com/nhl/rankings/player/cap-hit';
const SPOTRAC_CONTRACTS_BASE = 'https://www.spotrac.com/nhl/contracts';
const MAX_PAGES = 10; // 100 players per page → up to 1000 players
const PAGE_DELAY_MS = 1000;

/**
 * Parses Spotrac current-year cap hit rankings page.
 * Format:
 * <div class="link"><a href=".../player/..." ...>Player Name</a></div>
 * <small>... TEAM, POS</small>
 * <span class="medium">... $12,500,000</span>
 */
export function parseSpotracRankingsHTML(html: string): SalaryEntry[] {
  const entries: SalaryEntry[] = [];
  const itemRegex =
    /<div class="link"><a href="[^"]*\/player\/[^"]*"[^>]*>([^<]+)<\/a><\/div>[\s\S]*?<span class="medium">[\s\S]*?\$([0-9,]+)/g;

  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(html)) !== null) {
    const name = match[1].trim();
    if (!name.includes(' ')) continue;

    const capRaw = match[2].replace(/[$,\s]/g, '');
    const capHit = parseInt(capRaw, 10) / 1_000_000;

    if (capHit > 0 && capHit < 30) {
      entries.push({
        name,
        capHit: Math.round(capHit * 1000) / 1000,
      });
    }
  }

  return entries;
}

/**
 * Fetches all active player current-year cap hits directly from Spotrac rankings.
 * Falls back to active contracts pagination if rankings endpoint fails.
 */
export async function fetchSpotracSalaries(
  year = String(new Date().getMonth() >= 8 ? new Date().getFullYear() : new Date().getFullYear() - 1)
): Promise<SalaryEntry[]> {
  // Strategy 1: Fetch full current-year rankings (contains ~800 players in one clean page with current-year cap hits)
  try {
    const rankingsUrl = `${SPOTRAC_RANKINGS_BASE}/${year}/`;
    const res = await fetch(rankingsUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      cache: 'no-store',
    });

    if (res.ok) {
      const html = await res.text();
      const entries = parseSpotracRankingsHTML(html);
      if (entries.length > 300) {
        console.log(`[spotrac] Successfully fetched ${entries.length} current-year salaries from rankings`);
        return entries;
      }
    }
  } catch (err) {
    console.warn('[spotrac] Rankings fetch failed, falling back to contracts:', err);
  }

  // Strategy 2: Multi-page contracts fallback
  const all: SalaryEntry[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1) {
      await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
    }
    const url = page === 1 ? `${SPOTRAC_CONTRACTS_BASE}/` : `${SPOTRAC_CONTRACTS_BASE}/${page}/`;
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        },
        cache: 'no-store',
      });
      if (!res.ok) {
        console.warn(`[spotrac] page ${page} returned HTTP ${res.status} – stopping pagination`);
        break;
      }
      const html = await res.text();
      const entries = parseSpotracHTML(html);
      if (entries.length === 0) break;
      all.push(...entries);
      if (entries.length < 90) break;
    } catch (err) {
      console.warn(`[spotrac] page ${page} fetch error:`, err);
      break;
    }
  }

  // De-duplicate by normalized name (keep first occurrence = highest cap hit)
  const seen = new Set<string>();
  return all.filter((e) => {
    const key = normalizeName(e.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Matches salary entries with official NHL player IDs
 */
export function matchSalariesWithNHL(
  salaries: SalaryEntry[],
  nhlPlayers: Array<{ id: number; fullName: string; teamAbbrev?: string }>
): SalaryImportResult {
  const normMap = new Map<string, { id: number; fullName: string }>();
  for (const p of nhlPlayers) {
    normMap.set(normalizeName(p.fullName), { id: p.id, fullName: p.fullName });
  }

  const matched: MatchResult[] = [];
  const unmatched: UnmatchedEntry[] = [];

  for (const s of salaries) {
    const key = normalizeName(s.name);
    const exact = normMap.get(key);

    if (exact) {
      matched.push({
        playerId: exact.id,
        playerName: exact.fullName,
        sourceName: s.name,
        capHit: s.capHit,
        confidence: 'exact',
      });
    } else {
      // Same last name + same first initial, only if unambiguous
      const sLast = lastNameKey(s.name);
      const sInit = normalizeName(s.name)[0];
      const cands = nhlPlayers.filter(
        (p) => lastNameKey(p.fullName) === sLast && normalizeName(p.fullName)[0] === sInit
      );
      if (cands.length === 1) {
        matched.push({
          playerId: cands[0].id,
          playerName: cands[0].fullName,
          sourceName: s.name,
          capHit: s.capHit,
          confidence: 'fuzzy',
          fuzzyScore: 0.9,
        });
        continue;
      }

      // Fuzzy search across players
      let bestScore = 0;
      let bestPlayer: { id: number; fullName: string } | null = null;

      for (const p of nhlPlayers) {
        const sim = nameSimilarity(s.name, p.fullName);
        if (sim > bestScore) {
          bestScore = sim;
          bestPlayer = p;
        }
      }

      if (bestScore >= 0.85 && bestPlayer) {
        matched.push({
          playerId: bestPlayer.id,
          playerName: bestPlayer.fullName,
          sourceName: s.name,
          capHit: s.capHit,
          confidence: 'fuzzy',
          fuzzyScore: bestScore,
        });
      } else {
        unmatched.push({
          sourceName: s.name,
          capHit: s.capHit,
          bestMatch: bestPlayer ? { playerId: bestPlayer.id, playerName: bestPlayer.fullName, score: bestScore } : undefined,
        });
      }
    }
  }

  return {
    matched,
    unmatched,
    totalParsed: salaries.length,
  };
}
