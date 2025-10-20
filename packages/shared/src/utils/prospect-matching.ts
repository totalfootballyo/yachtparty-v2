/**
 * Prospect Matching Utilities
 *
 * Handles fuzzy matching between prospects and users for upgrade flow.
 *
 * Design Philosophy:
 * - Start conservative, tune over time
 * - Modular scoring system that can be improved
 * - Log all matches for analysis and tuning
 * - Configurable confidence thresholds
 *
 * Future Improvements:
 * - Levenshtein distance for typos
 * - ML-based matching
 * - Manual review workflow for medium-confidence matches
 */

export interface ProspectMatchScore {
  prospectId: string;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  matchedFields: string[];
  reasoning: string[];
}

// Type alias for convenience
export type ProspectMatch = ProspectMatchScore;

/**
 * Normalize email for fuzzy matching.
 *
 * Examples:
 * - jason.jones@thetradedesk.com → jasonjones@thetradedesk.com
 * - jjones@thetradedesk.com → jjones@thetradedesk.com
 * - jason-jones@the-trade-desk.com → jasonjones@thetradedesk.com
 */
function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;

  const lower = email.toLowerCase().trim();
  const [user, domain] = lower.split('@');

  if (!user || !domain) return lower;

  // Remove common separators from user part
  const normalizedUser = user.replace(/[.\-_]/g, '');

  // Remove hyphens from domain (the-trade-desk.com → thetradedesk.com)
  const normalizedDomain = domain.replace(/\-/g, '');

  return `${normalizedUser}@${normalizedDomain}`;
}

/**
 * Normalize name for matching.
 *
 * Examples:
 * - "Jason Jones" → "jasonjones"
 * - "Jason M. Jones" → "jasonjones" (removes middle initial)
 */
function normalizeName(firstName: string | null | undefined, lastName: string | null | undefined): string | null {
  if (!firstName && !lastName) return null;

  const parts = [];

  if (firstName) {
    // Remove middle initials (single letters followed by period)
    const cleaned = firstName.toLowerCase().trim().replace(/\s+[a-z]\.\s*/g, ' ');
    parts.push(cleaned.replace(/[.\-_\s]/g, ''));
  }

  if (lastName) {
    parts.push(lastName.toLowerCase().trim().replace(/[.\-_\s]/g, ''));
  }

  return parts.join('');
}

/**
 * Normalize company name for matching.
 *
 * Examples:
 * - "The Trade Desk" → "tradedesk"
 * - "Trade Desk, Inc." → "tradedesk"
 */
function normalizeCompany(company: string | null | undefined): string | null {
  if (!company) return null;

  return company
    .toLowerCase()
    .trim()
    // Remove common suffixes
    .replace(/,?\s*(inc|llc|corp|corporation|ltd|limited)\.?$/i, '')
    // Remove "the" prefix
    .replace(/^the\s+/i, '')
    // Remove separators
    .replace(/[.\-_\s]/g, '');
}

/**
 * Extract email domain for matching.
 */
function getEmailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const parts = email.toLowerCase().trim().split('@');
  return parts[1] || null;
}

/**
 * Calculate match score between a prospect and user.
 *
 * Scoring system:
 * - Exact email match: 100 points (definitive)
 * - Exact phone match: 100 points (definitive)
 * - Exact LinkedIn match: 100 points (definitive)
 * - Fuzzy email match (same domain, similar user): 80 points (high confidence)
 * - Name + company match: 60 points (medium confidence)
 * - Name + email domain match: 70 points (medium-high confidence)
 *
 * Confidence thresholds:
 * - 100+: High confidence (exact match on at least one field)
 * - 70-99: Medium confidence (fuzzy email or name+company+domain)
 * - 40-69: Low confidence (partial matches, needs review)
 * - <40: No match
 */
export function calculateProspectMatchScore(
  prospect: {
    id: string;
    email?: string | null;
    phone_number?: string | null;
    linkedin_url?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    company?: string | null;
  },
  user: {
    email?: string | null;
    phone_number?: string | null;
    linkedin_url?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    company?: string | null;
  }
): ProspectMatchScore {
  let score = 0;
  const matchedFields: string[] = [];
  const reasoning: string[] = [];

  // Exact email match (100 points)
  if (prospect.email && user.email && prospect.email.toLowerCase() === user.email.toLowerCase()) {
    score += 100;
    matchedFields.push('email_exact');
    reasoning.push('Exact email match');
  }

  // Exact phone match (100 points)
  if (prospect.phone_number && user.phone_number && prospect.phone_number === user.phone_number) {
    score += 100;
    matchedFields.push('phone_exact');
    reasoning.push('Exact phone match');
  }

  // Exact LinkedIn match (100 points)
  if (prospect.linkedin_url && user.linkedin_url) {
    const prospectLinkedIn = prospect.linkedin_url.toLowerCase().trim();
    const userLinkedIn = user.linkedin_url.toLowerCase().trim();

    if (prospectLinkedIn === userLinkedIn) {
      score += 100;
      matchedFields.push('linkedin_exact');
      reasoning.push('Exact LinkedIn match');
    }
  }

  // If we already have an exact match, no need for fuzzy matching
  if (score >= 100) {
    return {
      prospectId: prospect.id,
      score,
      confidence: 'high',
      matchedFields,
      reasoning,
    };
  }

  // Fuzzy email matching (80 points)
  if (prospect.email && user.email) {
    const prospectNormalized = normalizeEmail(prospect.email);
    const userNormalized = normalizeEmail(user.email);

    if (prospectNormalized === userNormalized) {
      score += 80;
      matchedFields.push('email_fuzzy');
      reasoning.push(`Fuzzy email match (${prospect.email} ≈ ${user.email})`);
    } else {
      // Same domain, different user part (partial credit)
      const prospectDomain = getEmailDomain(prospect.email);
      const userDomain = getEmailDomain(user.email);

      if (prospectDomain && userDomain && prospectDomain === userDomain) {
        // Check if normalized user parts are similar
        const [prospectUser] = (prospectNormalized || '').split('@');
        const [userUser] = (userNormalized || '').split('@');

        if (prospectUser && userUser && prospectUser.includes(userUser.slice(0, 3))) {
          score += 40;
          matchedFields.push('email_domain_partial');
          reasoning.push(`Same email domain, similar user part`);
        }
      }
    }
  }

  // Name matching
  const prospectName = normalizeName(prospect.first_name, prospect.last_name);
  const userName = normalizeName(user.first_name, user.last_name);
  const nameMatch = prospectName && userName && prospectName === userName;

  // Company matching
  const prospectCompany = normalizeCompany(prospect.company);
  const userCompany = normalizeCompany(user.company);
  const companyMatch = prospectCompany && userCompany && prospectCompany === userCompany;

  // Name + Company match (60 points)
  if (nameMatch && companyMatch) {
    score += 60;
    matchedFields.push('name_company');
    reasoning.push(`Name and company match (${prospect.first_name} ${prospect.last_name} at ${prospect.company})`);
  }

  // Name + Email domain match (70 points - higher than name+company because email is harder to fake)
  if (nameMatch && prospect.email && user.email) {
    const prospectDomain = getEmailDomain(prospect.email);
    const userDomain = getEmailDomain(user.email);

    if (prospectDomain && userDomain && prospectDomain === userDomain) {
      // Only award if we haven't already counted email fuzzy match
      if (!matchedFields.includes('email_fuzzy')) {
        score += 70;
        matchedFields.push('name_email_domain');
        reasoning.push(`Name match + same email domain (@${prospectDomain})`);
      }
    }
  }

  // Determine confidence
  let confidence: 'high' | 'medium' | 'low';
  if (score >= 100) {
    confidence = 'high';
  } else if (score >= 70) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return {
    prospectId: prospect.id,
    score,
    confidence,
    matchedFields,
    reasoning,
  };
}

/**
 * Find all matching prospects for a user.
 *
 * Returns prospects sorted by match score (highest first).
 * Only returns prospects with score >= minScore.
 */
export function findMatchingProspects(
  prospects: Array<{
    id: string;
    email?: string | null;
    phone_number?: string | null;
    linkedin_url?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    company?: string | null;
  }>,
  user: {
    email?: string | null;
    phone_number?: string | null;
    linkedin_url?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    company?: string | null;
  },
  options: {
    minScore?: number; // Default: 70 (medium confidence or higher)
    maxResults?: number; // Default: unlimited
  } = {}
): ProspectMatchScore[] {
  const { minScore = 70, maxResults } = options;

  const scores = prospects
    .map(prospect => calculateProspectMatchScore(prospect, user))
    .filter(match => match.score >= minScore)
    .sort((a, b) => b.score - a.score);

  return maxResults ? scores.slice(0, maxResults) : scores;
}

/**
 * Configuration for matching behavior.
 * Can be adjusted based on monitoring and false positive/negative rates.
 */
export const MATCHING_CONFIG = {
  // Minimum score to auto-upgrade prospect (no manual review)
  AUTO_UPGRADE_THRESHOLD: 100,

  // Minimum score to consider a match (below this, ignore)
  MIN_MATCH_THRESHOLD: 70,

  // Score for manual review queue (future feature)
  MANUAL_REVIEW_THRESHOLD: 70,
};

/**
 * Helper to determine if a match should be auto-upgraded.
 */
export function shouldAutoUpgrade(match: ProspectMatchScore): boolean {
  return match.score >= MATCHING_CONFIG.AUTO_UPGRADE_THRESHOLD;
}
