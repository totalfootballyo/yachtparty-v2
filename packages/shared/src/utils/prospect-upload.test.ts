/**
 * Tests for Prospect Upload Utilities
 *
 * @jest-environment node
 */

import {
  validateProspectRecord,
  parseProspectCSV,
  type ProspectRecord
} from './prospect-upload';

describe('validateProspectRecord', () => {
  it('should validate record with email only', () => {
    const record: ProspectRecord = {
      email: 'test@example.com'
    };

    const result = validateProspectRecord(record, 1);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0); // Should warn about missing name
  });

  it('should validate record with phone only', () => {
    const record: ProspectRecord = {
      phone_number: '+1-555-123-4567'
    };

    const result = validateProspectRecord(record, 1);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should validate record with LinkedIn only', () => {
    const record: ProspectRecord = {
      linkedin_url: 'https://linkedin.com/in/johndoe'
    };

    const result = validateProspectRecord(record, 1);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should validate complete record', () => {
    const record: ProspectRecord = {
      email: 'john.doe@example.com',
      phone_number: '555-123-4567',
      linkedin_url: 'https://linkedin.com/in/johndoe',
      first_name: 'John',
      last_name: 'Doe',
      company: 'Example Corp',
      title: 'VP of Sales',
      prospect_notes: 'Met at conference'
    };

    const result = validateProspectRecord(record, 1);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('should reject record with no contact methods', () => {
    const record: ProspectRecord = {
      first_name: 'John',
      last_name: 'Doe'
    };

    const result = validateProspectRecord(record, 1);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('At least one contact method required (email, phone, or LinkedIn)');
  });

  it('should reject invalid email format', () => {
    const record: ProspectRecord = {
      email: 'not-an-email'
    };

    const result = validateProspectRecord(record, 1);

    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Invalid email format'))).toBe(true);
  });

  it('should reject invalid phone number', () => {
    const record: ProspectRecord = {
      phone_number: '123' // Too short
    };

    const result = validateProspectRecord(record, 1);

    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Invalid phone number'))).toBe(true);
  });

  it('should reject invalid LinkedIn URL', () => {
    const record: ProspectRecord = {
      linkedin_url: 'https://twitter.com/johndoe'
    };

    const result = validateProspectRecord(record, 1);

    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Invalid LinkedIn URL'))).toBe(true);
  });

  it('should normalize LinkedIn URL', () => {
    const record: ProspectRecord = {
      linkedin_url: 'http://www.linkedin.com/in/johndoe/'
    };

    const result = validateProspectRecord(record, 1);

    expect(result.isValid).toBe(true);
    expect(result.record?.linkedin_url).toBe('https://www.linkedin.com/in/johndoe');
  });

  it('should warn about missing name', () => {
    const record: ProspectRecord = {
      email: 'test@example.com',
      company: 'Example Corp'
    };

    const result = validateProspectRecord(record, 1);

    expect(result.isValid).toBe(true);
    expect(result.warnings.some(w => w.includes('Name not provided'))).toBe(true);
  });

  it('should warn about missing company', () => {
    const record: ProspectRecord = {
      email: 'test@example.com',
      first_name: 'John',
      last_name: 'Doe'
    };

    const result = validateProspectRecord(record, 1);

    expect(result.isValid).toBe(true);
    expect(result.warnings.some(w => w.includes('Company not provided'))).toBe(true);
  });
});

describe('parseProspectCSV', () => {
  it('should parse simple CSV with all fields', () => {
    const csv = `email,phone_number,linkedin_url,first_name,last_name,company,title
john@example.com,555-123-4567,https://linkedin.com/in/johndoe,John,Doe,Example Corp,VP Sales`;

    const results = parseProspectCSV(csv);

    expect(results).toHaveLength(1);
    expect(results[0].row).toBe(2);
    expect(results[0].validation.isValid).toBe(true);
    expect(results[0].validation.record?.email).toBe('john@example.com');
    expect(results[0].validation.record?.first_name).toBe('John');
    expect(results[0].validation.record?.company).toBe('Example Corp');
  });

  it('should parse CSV with header variations', () => {
    const csv = `email,phone,linkedin,first_name,last_name,company,title
jane@example.com,555-987-6543,https://linkedin.com/in/janedoe,Jane,Doe,Tech Inc,CTO`;

    const results = parseProspectCSV(csv);

    expect(results).toHaveLength(1);
    expect(results[0].validation.isValid).toBe(true);
    expect(results[0].validation.record?.phone_number).toBe('555-987-6543');
    expect(results[0].validation.record?.linkedin_url).toBe('https://linkedin.com/in/janedoe');
  });

  it('should parse CSV with notes and categories', () => {
    const csv = `email,first_name,last_name,notes,categories
john@example.com,John,Doe,Met at conference,Sales;Marketing`;

    const results = parseProspectCSV(csv);

    expect(results).toHaveLength(1);
    expect(results[0].validation.isValid).toBe(true);
    expect(results[0].validation.record?.prospect_notes).toBe('Met at conference');
    expect(results[0].validation.record?.target_solution_categories).toEqual(['Sales', 'Marketing']);
  });

  it('should handle multiple rows', () => {
    const csv = `email,first_name,last_name,company
john@example.com,John,Doe,Example Corp
jane@example.com,Jane,Smith,Tech Inc
bob@example.com,Bob,Johnson,Startup LLC`;

    const results = parseProspectCSV(csv);

    expect(results).toHaveLength(3);
    expect(results[0].validation.isValid).toBe(true);
    expect(results[1].validation.isValid).toBe(true);
    expect(results[2].validation.isValid).toBe(true);
  });

  it('should skip empty lines', () => {
    const csv = `email,first_name,last_name
john@example.com,John,Doe

jane@example.com,Jane,Smith`;

    const results = parseProspectCSV(csv);

    expect(results).toHaveLength(2); // Should only have 2 records, not 3
  });

  it('should handle invalid records', () => {
    const csv = `email,first_name,last_name
invalid-email,John,Doe
jane@example.com,Jane,Smith`;

    const results = parseProspectCSV(csv);

    expect(results).toHaveLength(2);
    expect(results[0].validation.isValid).toBe(false);
    expect(results[1].validation.isValid).toBe(true);
  });

  it('should handle empty CSV', () => {
    const csv = '';

    const results = parseProspectCSV(csv);

    expect(results).toHaveLength(0);
  });

  it('should handle CSV with only headers', () => {
    const csv = 'email,first_name,last_name';

    const results = parseProspectCSV(csv);

    expect(results).toHaveLength(0);
  });

  it('should handle partial data', () => {
    const csv = `email,phone_number,first_name,last_name
john@example.com,,John,Doe
,555-123-4567,Jane,Smith`;

    const results = parseProspectCSV(csv);

    expect(results).toHaveLength(2);
    expect(results[0].validation.isValid).toBe(true);
    expect(results[0].validation.record?.phone_number).toBeUndefined();
    expect(results[1].validation.isValid).toBe(true);
    expect(results[1].validation.record?.email).toBeUndefined();
  });

  it('should parse real-world example from user story', () => {
    const csv = `email,phone_number,first_name,last_name,company,title
jason.jones@thetradedesk.com,,Jason,Jones,Trade Desk,VP of Sales
jjones@thetradedesk.com,555-123-4567,Jason,Jones,The Trade Desk,SVP Revenue`;

    const results = parseProspectCSV(csv);

    expect(results).toHaveLength(2);
    expect(results[0].validation.isValid).toBe(true);
    expect(results[0].validation.record?.email).toBe('jason.jones@thetradedesk.com');
    expect(results[1].validation.isValid).toBe(true);
    expect(results[1].validation.record?.email).toBe('jjones@thetradedesk.com');
  });
});

describe('Edge Cases', () => {
  it('should handle records with only whitespace in fields', () => {
    const record: ProspectRecord = {
      email: '   ',
      phone_number: '  ',
      linkedin_url: ' '
    };

    const result = validateProspectRecord(record, 1);

    // Whitespace-only fields should be treated as empty
    // So this should fail the "at least one contact method" check
    expect(result.isValid).toBe(false);
  });

  it('should handle very long email addresses', () => {
    const record: ProspectRecord = {
      email: 'this.is.a.very.long.email.address.that.might.break.things@verylongdomainname.example.com'
    };

    const result = validateProspectRecord(record, 1);

    expect(result.isValid).toBe(true);
  });

  it('should handle international phone numbers', () => {
    const record: ProspectRecord = {
      phone_number: '+44 20 7946 0958' // UK number
    };

    const result = validateProspectRecord(record, 1);

    expect(result.isValid).toBe(true);
  });

  it('should handle LinkedIn URLs without protocol', () => {
    const record: ProspectRecord = {
      linkedin_url: 'linkedin.com/in/johndoe'
    };

    const result = validateProspectRecord(record, 1);

    // This should fail validation since we require https://
    expect(result.isValid).toBe(false);
  });
});
