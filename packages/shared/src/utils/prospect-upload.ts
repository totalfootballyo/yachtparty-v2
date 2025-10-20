/**
 * Prospect Upload Utilities
 *
 * Handles CSV parsing, validation, and batch uploads for innovator prospects.
 *
 * @module prospect-upload
 */

import { createServiceClient } from './supabase';
import { v4 as uuidv4 } from 'uuid';

/**
 * Parsed prospect record from CSV.
 */
export interface ProspectRecord {
  email?: string;
  phone_number?: string;
  linkedin_url?: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  title?: string;
  prospect_notes?: string;
  target_solution_categories?: string[];
}

/**
 * Validation result for a single prospect.
 */
export interface ProspectValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  record?: ProspectRecord;
}

/**
 * Result of batch upload operation.
 */
export interface ProspectUploadResult {
  success: boolean;
  uploadBatchId?: string;
  recordsProcessed: number;
  recordsInserted: number;
  recordsFailed: number;
  errors: Array<{
    row: number;
    errors: string[];
  }>;
}

/**
 * Validates email format.
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validates phone number (basic check for 10+ digits).
 */
function isValidPhone(phone: string): boolean {
  const digitsOnly = phone.replace(/\D/g, '');
  return digitsOnly.length >= 10;
}

/**
 * Validates LinkedIn URL.
 */
function isValidLinkedInUrl(url: string): boolean {
  const linkedInRegex = /^https?:\/\/(www\.)?linkedin\.com\/in\/[\w-]+\/?$/i;
  return linkedInRegex.test(url);
}

/**
 * Normalizes LinkedIn URL to standard format.
 */
function normalizeLinkedInUrl(url: string): string {
  // Ensure https://
  if (!url.startsWith('http')) {
    url = 'https://' + url;
  }

  // Remove trailing slash
  url = url.replace(/\/$/, '');

  return url;
}

/**
 * Validates a single prospect record.
 *
 * Requirements:
 * - At least one contact method (email, phone, or LinkedIn)
 * - Valid format for each provided contact method
 * - First and last name recommended (warning if missing)
 *
 * @param record - Prospect record to validate
 * @param rowNumber - Row number for error reporting
 * @returns Validation result
 */
export function validateProspectRecord(
  record: ProspectRecord,
  rowNumber: number
): ProspectValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for at least one contact method
  if (!record.email && !record.phone_number && !record.linkedin_url) {
    errors.push('At least one contact method required (email, phone, or LinkedIn)');
  }

  // Validate email format if provided
  if (record.email) {
    if (!isValidEmail(record.email)) {
      errors.push(`Invalid email format: ${record.email}`);
    }
  }

  // Validate phone format if provided
  if (record.phone_number) {
    if (!isValidPhone(record.phone_number)) {
      errors.push(`Invalid phone number: ${record.phone_number}`);
    }
  }

  // Validate LinkedIn URL if provided
  if (record.linkedin_url) {
    if (!isValidLinkedInUrl(record.linkedin_url)) {
      errors.push(`Invalid LinkedIn URL: ${record.linkedin_url}`);
    } else {
      // Normalize the URL
      record.linkedin_url = normalizeLinkedInUrl(record.linkedin_url);
    }
  }

  // Warnings for missing recommended fields
  if (!record.first_name && !record.last_name) {
    warnings.push('Name not provided - will make matching harder');
  }

  if (!record.company) {
    warnings.push('Company not provided - will make matching harder');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    record: errors.length === 0 ? record : undefined
  };
}

/**
 * Parses CSV content into prospect records.
 *
 * Expected CSV format (headers):
 * - email (optional)
 * - phone_number or phone (optional)
 * - linkedin_url or linkedin (optional)
 * - first_name (optional)
 * - last_name (optional)
 * - company (optional)
 * - title (optional)
 * - notes or prospect_notes (optional)
 * - categories or target_solution_categories (optional, comma-separated)
 *
 * @param csvContent - CSV file content as string
 * @returns Array of parsed records with validation results
 */
export function parseProspectCSV(csvContent: string): Array<{
  row: number;
  validation: ProspectValidationResult;
}> {
  const lines = csvContent.trim().split('\n');

  if (lines.length === 0) {
    return [];
  }

  // Parse header row
  const headerRow = lines[0];
  const headers = headerRow.split(',').map(h => h.trim().toLowerCase());

  // Map common header variations to our schema
  const headerMap: Record<string, string> = {
    'phone': 'phone_number',
    'linkedin': 'linkedin_url',
    'notes': 'prospect_notes',
    'categories': 'target_solution_categories'
  };

  const normalizedHeaders = headers.map(h => headerMap[h] || h);

  // Parse data rows
  const results: Array<{
    row: number;
    validation: ProspectValidationResult;
  }> = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // Skip empty lines

    const values = line.split(',').map(v => v.trim());
    const record: ProspectRecord = {};

    // Map values to fields
    normalizedHeaders.forEach((header, index) => {
      const value = values[index];
      if (!value) return;

      if (header === 'target_solution_categories') {
        // Split comma-separated categories (if in quotes, handle that)
        record.target_solution_categories = value
          .split(';')
          .map(c => c.trim())
          .filter(c => c.length > 0);
      } else if (['email', 'phone_number', 'linkedin_url', 'first_name', 'last_name', 'company', 'title', 'prospect_notes'].includes(header)) {
        record[header as keyof ProspectRecord] = value as any;
      }
    });

    // Validate the record
    const validation = validateProspectRecord(record, i + 1);
    results.push({
      row: i + 1,
      validation
    });
  }

  return results;
}

/**
 * Uploads prospects to database in a batch.
 *
 * All prospects in the batch share the same:
 * - innovator_id
 * - upload_batch_id
 * - upload_source
 *
 * @param innovatorId - User ID of the innovator uploading prospects
 * @param prospects - Array of validated prospect records
 * @param uploadSource - Source identifier (e.g., 'csv_upload', 'manual_entry')
 * @returns Upload result with success/failure counts
 */
export async function uploadProspectsBatch(
  innovatorId: string,
  prospects: ProspectRecord[],
  uploadSource: string = 'csv_upload'
): Promise<ProspectUploadResult> {
  const supabase = createServiceClient();
  const uploadBatchId = uuidv4();

  const recordsToInsert = prospects.map(prospect => ({
    ...prospect,
    innovator_id: innovatorId,
    upload_batch_id: uploadBatchId,
    upload_source: uploadSource,
    status: 'pending',
    uploaded_at: new Date().toISOString()
  }));

  try {
    const { data, error } = await supabase
      .from('prospects')
      .insert(recordsToInsert)
      .select();

    if (error) {
      console.error('Error inserting prospects:', error);
      return {
        success: false,
        recordsProcessed: prospects.length,
        recordsInserted: 0,
        recordsFailed: prospects.length,
        errors: [{
          row: 0,
          errors: [error.message]
        }]
      };
    }

    // Publish event for batch upload
    await supabase
      .from('events')
      .insert({
        event_type: 'prospects.batch_uploaded',
        aggregate_id: uploadBatchId,
        aggregate_type: 'prospect_batch',
        payload: {
          innovator_id: innovatorId,
          upload_source: uploadSource,
          record_count: data?.length || 0
        },
        created_by: 'innovator_agent'
      });

    return {
      success: true,
      uploadBatchId,
      recordsProcessed: prospects.length,
      recordsInserted: data?.length || 0,
      recordsFailed: 0,
      errors: []
    };
  } catch (error: any) {
    console.error('Unexpected error during batch upload:', error);
    return {
      success: false,
      recordsProcessed: prospects.length,
      recordsInserted: 0,
      recordsFailed: prospects.length,
      errors: [{
        row: 0,
        errors: [error.message || 'Unknown error']
      }]
    };
  }
}

/**
 * Processes CSV upload end-to-end.
 *
 * Steps:
 * 1. Parse CSV
 * 2. Validate all records
 * 3. Upload valid records in batch
 * 4. Return detailed results
 *
 * @param innovatorId - User ID of the innovator
 * @param csvContent - CSV file content as string
 * @param uploadSource - Source identifier
 * @returns Upload result with validation details
 */
export async function processProspectCSVUpload(
  innovatorId: string,
  csvContent: string,
  uploadSource: string = 'csv_upload'
): Promise<ProspectUploadResult> {
  // Parse and validate
  const parsedResults = parseProspectCSV(csvContent);

  const validRecords: ProspectRecord[] = [];
  const errors: Array<{ row: number; errors: string[] }> = [];

  parsedResults.forEach(({ row, validation }) => {
    if (validation.isValid && validation.record) {
      validRecords.push(validation.record);
    } else {
      errors.push({
        row,
        errors: validation.errors
      });
    }
  });

  // If no valid records, return early
  if (validRecords.length === 0) {
    return {
      success: false,
      recordsProcessed: parsedResults.length,
      recordsInserted: 0,
      recordsFailed: parsedResults.length,
      errors
    };
  }

  // Upload valid records
  const uploadResult = await uploadProspectsBatch(
    innovatorId,
    validRecords,
    uploadSource
  );

  return {
    ...uploadResult,
    recordsProcessed: parsedResults.length,
    recordsFailed: errors.length,
    errors: [...errors, ...uploadResult.errors]
  };
}
