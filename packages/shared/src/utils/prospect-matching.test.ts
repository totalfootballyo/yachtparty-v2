/**
 * Tests for prospect matching utilities
 */

import {
  calculateProspectMatchScore,
  findMatchingProspects,
  shouldAutoUpgrade,
} from './prospect-matching';

describe('Prospect Matching', () => {
  describe('calculateProspectMatchScore', () => {
    it('should match exact email', () => {
      const prospect = {
        id: '1',
        email: 'jason.jones@thetradedesk.com',
        first_name: 'Jason',
        last_name: 'Jones',
        company: 'The Trade Desk',
      };

      const user = {
        email: 'jason.jones@thetradedesk.com',
        first_name: 'Jason',
        last_name: 'Jones',
        company: 'Trade Desk',
      };

      const score = calculateProspectMatchScore(prospect, user);

      expect(score.score).toBe(100);
      expect(score.confidence).toBe('high');
      expect(score.matchedFields).toContain('email_exact');
    });

    it('should fuzzy match email variants (jason.jones vs jasonjones)', () => {
      const prospect = {
        id: '1',
        email: 'jason.jones@thetradedesk.com',
        first_name: 'Jason',
        last_name: 'Jones',
        company: 'The Trade Desk',
      };

      const user = {
        email: 'jasonjones@thetradedesk.com',
        first_name: 'Jason',
        last_name: 'Jones',
        company: 'Trade Desk',
      };

      const score = calculateProspectMatchScore(prospect, user);

      expect(score.score).toBe(80); // Fuzzy email match
      expect(score.confidence).toBe('medium');
      expect(score.matchedFields).toContain('email_fuzzy');
      expect(score.reasoning).toContainEqual(
        expect.stringContaining('Fuzzy email match')
      );
    });

    it('should handle the Trade Desk example: innovator 1', () => {
      // Innovator 1 uploads: Jason Jones, VP Sales, jason.jones@thetradedesk.com
      const prospect1 = {
        id: 'prospect-1',
        email: 'jason.jones@thetradedesk.com',
        first_name: 'Jason',
        last_name: 'Jones',
        company: 'Trade Desk',
        title: 'VP of Sales',
      };

      // User joins: Jason Jones, CRO, jasonjones@thetradedesk.com
      const user = {
        email: 'jasonjones@thetradedesk.com',
        first_name: 'Jason',
        last_name: 'Jones',
        company: 'The Trade Desk',
        title: 'CRO',
      };

      const score = calculateProspectMatchScore(prospect1, user);

      // Should match via fuzzy email (jason.jones@ vs jasonjones@)
      expect(score.score).toBe(80);
      expect(score.confidence).toBe('medium');
      expect(score.matchedFields).toContain('email_fuzzy');
    });

    it('should handle the Trade Desk example: innovator 2', () => {
      // Innovator 2 uploads: Jason Jones, SVP Revenue, jjones@thetradedesk.com
      const prospect2 = {
        id: 'prospect-2',
        email: 'jjones@thetradedesk.com',
        first_name: 'Jason',
        last_name: 'Jones',
        company: 'The Trade Desk',
        title: 'SVP Revenue',
      };

      // User joins: Jason Jones, CRO, jasonjones@thetradedesk.com
      const user = {
        email: 'jasonjones@thetradedesk.com',
        first_name: 'Jason',
        last_name: 'Jones',
        company: 'The Trade Desk',
        title: 'CRO',
      };

      const score = calculateProspectMatchScore(prospect2, user);

      // Should match via name + email domain (both jjones and jasonjones at same company/domain)
      expect(score.score).toBeGreaterThanOrEqual(70);
      expect(score.confidence).toEqual('medium');
      expect(score.matchedFields).toContain('name_email_domain');
    });

    it('should find all matching prospects for Trade Desk example', () => {
      // Innovator 1's prospect
      const prospect1 = {
        id: 'prospect-1',
        email: 'jason.jones@thetradedesk.com',
        first_name: 'Jason',
        last_name: 'Jones',
        company: 'Trade Desk',
      };

      // Innovator 2's prospect
      const prospect2 = {
        id: 'prospect-2',
        email: 'jjones@thetradedesk.com',
        first_name: 'Jason',
        last_name: 'Jones',
        company: 'The Trade Desk',
      };

      // Different Jason Jones (should NOT match - different email domain)
      const prospect3 = {
        id: 'prospect-3',
        email: 'jason.jones@competitor.com',
        first_name: 'Jason',
        last_name: 'Jones',
        company: 'Competitor Inc',
      };

      // User joins
      const user = {
        email: 'jasonjones@thetradedesk.com',
        first_name: 'Jason',
        last_name: 'Jones',
        company: 'The Trade Desk',
      };

      const matches = findMatchingProspects(
        [prospect1, prospect2, prospect3],
        user,
        { minScore: 70 }
      );

      // Should match prospects 1 and 2, but NOT 3
      expect(matches).toHaveLength(2);
      expect(matches[0].prospectId).toEqual('prospect-1'); // Higher score (fuzzy email)
      expect(matches[1].prospectId).toEqual('prospect-2'); // Medium score (name + domain)
      expect(matches.some(m => m.prospectId === 'prospect-3')).toBe(false);
    });

    it('should NOT match different people with same name', () => {
      // Prospect: Jason Jones at Trade Desk
      const prospect = {
        id: 'prospect-1',
        email: 'jason.jones@thetradedesk.com',
        first_name: 'Jason',
        last_name: 'Jones',
        company: 'The Trade Desk',
      };

      // User: Different Jason Jones at different company
      const user = {
        email: 'jason.jones@competitor.com',
        first_name: 'Jason',
        last_name: 'Jones',
        company: 'Competitor Corp',
      };

      const score = calculateProspectMatchScore(prospect, user);

      // Should have low score (name match but different company and email domain)
      expect(score.score).toBeLessThan(70);
    });

    it('should match phone number exactly', () => {
      const prospect = {
        id: '1',
        phone_number: '+15551234567',
        first_name: 'Jane',
        last_name: 'Doe',
      };

      const user = {
        phone_number: '+15551234567',
        first_name: 'Jane',
        last_name: 'Doe',
      };

      const score = calculateProspectMatchScore(prospect, user);

      expect(score.score).toBe(100);
      expect(score.confidence).toBe('high');
      expect(score.matchedFields).toContain('phone_exact');
    });

    it('should match LinkedIn URL exactly', () => {
      const prospect = {
        id: '1',
        linkedin_url: 'https://linkedin.com/in/jasonjones',
        first_name: 'Jason',
        last_name: 'Jones',
      };

      const user = {
        linkedin_url: 'https://linkedin.com/in/jasonjones',
        first_name: 'Jason',
        last_name: 'Jones',
      };

      const score = calculateProspectMatchScore(prospect, user);

      expect(score.score).toBe(100);
      expect(score.confidence).toBe('high');
      expect(score.matchedFields).toContain('linkedin_exact');
    });

    it('should only auto-upgrade on exact matches (score 100+)', () => {
      const exactMatch = {
        prospectId: '1',
        score: 100,
        confidence: 'high' as const,
        matchedFields: ['email_exact'],
        reasoning: ['Exact email match'],
      };

      const fuzzyMatch = {
        prospectId: '2',
        score: 80,
        confidence: 'medium' as const,
        matchedFields: ['email_fuzzy'],
        reasoning: ['Fuzzy email match'],
      };

      expect(shouldAutoUpgrade(exactMatch)).toBe(true);
      expect(shouldAutoUpgrade(fuzzyMatch)).toBe(false);
    });

    it('should handle domain normalization (the-trade-desk.com vs thetradedesk.com)', () => {
      const prospect = {
        id: '1',
        email: 'jason.jones@the-trade-desk.com',
        first_name: 'Jason',
        last_name: 'Jones',
        company: 'The Trade Desk',
      };

      const user = {
        email: 'jasonjones@thetradedesk.com',
        first_name: 'Jason',
        last_name: 'Jones',
        company: 'Trade Desk',
      };

      const score = calculateProspectMatchScore(prospect, user);

      // Should match via email fuzzy (normalizes hyphens in domain)
      expect(score.score).toBe(80);
      expect(score.matchedFields).toContain('email_fuzzy');
    });
  });

  describe('findMatchingProspects', () => {
    it('should return matches sorted by score', () => {
      const exactMatch = {
        id: '1',
        email: 'exact@example.com',
        first_name: 'John',
        last_name: 'Doe',
      };

      const fuzzyMatch = {
        id: '2',
        email: 'john.doe@example.com',
        first_name: 'John',
        last_name: 'Doe',
      };

      const mediumMatch = {
        id: '3',
        email: 'jdoe@example.com',
        first_name: 'John',
        last_name: 'Doe',
        company: 'Example Corp',
      };

      const user = {
        email: 'exact@example.com',
        first_name: 'John',
        last_name: 'Doe',
        company: 'Example Corp',
      };

      const matches = findMatchingProspects(
        [fuzzyMatch, mediumMatch, exactMatch],
        user,
        { minScore: 70 }
      );

      // Should be sorted by score (highest first)
      expect(matches[0].prospectId).toBe('1'); // 100 - exact
      expect(matches[1].prospectId).toBe('2'); // 80 - fuzzy email
      expect(matches[2].prospectId).toBe('3'); // 70 - name + domain
    });

    it('should respect maxResults parameter', () => {
      const prospects = [
        { id: '1', email: 'test1@example.com', first_name: 'John', last_name: 'Doe' },
        { id: '2', email: 'test2@example.com', first_name: 'John', last_name: 'Doe' },
        { id: '3', email: 'test3@example.com', first_name: 'John', last_name: 'Doe' },
      ];

      const user = {
        email: 'john.doe@example.com',
        first_name: 'John',
        last_name: 'Doe',
      };

      const matches = findMatchingProspects(prospects, user, {
        minScore: 70,
        maxResults: 2,
      });

      expect(matches).toHaveLength(2);
    });
  });
});
