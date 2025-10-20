/**
 * Account Manager Agent - Response Parsers
 *
 * Parsers for Claude API responses.
 * Handles JSON extraction and validation.
 *
 * @module account-manager/parsers
 */

import type {
  AccountManagerAction,
  PriorityUpdateDecision,
  PriorityType,
} from './types';

/**
 * Extracts JSON from Claude's response text.
 *
 * Handles various formats:
 * - Pure JSON
 * - JSON wrapped in markdown code fences
 * - JSON with explanatory text before/after
 */
export function extractJSON(text: string): any {
  let cleanText = text.trim();

  // Remove markdown code fences if present
  if (cleanText.startsWith('```json')) {
    cleanText = cleanText.replace(/^```json\s*\n?/, '').replace(/\n?```\s*$/, '');
  } else if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  // Try parsing directly
  try {
    return JSON.parse(cleanText);
  } catch (firstError) {
    // Find JSON object within text
    const jsonStartMatch = cleanText.match(/[{\[]/);

    if (!jsonStartMatch) {
      throw new Error('No JSON object or array found in response');
    }

    const startIndex = jsonStartMatch.index!;
    const startChar = jsonStartMatch[0];
    const endChar = startChar === '{' ? '}' : ']';

    // Find matching closing brace/bracket
    let depth = 0;
    let endIndex = -1;

    for (let i = startIndex; i < cleanText.length; i++) {
      const char = cleanText[i];

      if (char === startChar) {
        depth++;
      } else if (char === endChar) {
        depth--;
        if (depth === 0) {
          endIndex = i;
          break;
        }
      }
    }

    if (endIndex === -1) {
      throw new Error('No matching closing brace/bracket found');
    }

    // Extract and parse JSON substring
    const jsonText = cleanText.substring(startIndex, endIndex + 1);

    try {
      return JSON.parse(jsonText);
    } catch (secondError) {
      throw new Error(
        `Failed to parse extracted JSON: ${
          secondError instanceof Error ? secondError.message : String(secondError)
        }`
      );
    }
  }
}

/**
 * Parses Account Manager response into actions
 */
export function parseAccountManagerResponse(
  responseText: string,
  _existingPriorities: any[]
): AccountManagerAction[] {
  try {
    const decision = extractJSON(responseText) as PriorityUpdateDecision;

    // Validate required fields
    if (!decision.action) {
      console.warn('[Account Manager] Missing action in response:', decision);
      return [];
    }

    const actions: AccountManagerAction[] = [];

    switch (decision.action) {
      case 'ADD':
        if (!decision.priority_type || !decision.content) {
          console.warn('[Account Manager] ADD action missing required fields:', decision);
          break;
        }

        actions.push({
          type: 'update_priority',
          params: {
            priority_type: decision.priority_type,
            content: decision.content,
            status: 'active',
          },
          reason: decision.reason || 'New priority detected in conversation',
        });
        break;

      case 'UPDATE':
        if (!decision.priority_id || !decision.content) {
          console.warn('[Account Manager] UPDATE action missing required fields:', decision);
          break;
        }

        actions.push({
          type: 'update_priority',
          params: {
            priority_type: decision.priority_type || 'goal',
            content: decision.content,
            status: 'active',
            metadata: { updated_from_conversation: true },
          },
          reason: decision.reason || 'Priority updated from conversation',
        });
        break;

      case 'ARCHIVE':
        if (!decision.priority_id) {
          console.warn('[Account Manager] ARCHIVE action missing priority_id:', decision);
          break;
        }

        actions.push({
          type: 'archive_priority',
          params: {
            priority_id: decision.priority_id,
            reason: decision.reason || 'Priority no longer relevant',
          },
          reason: decision.reason || 'Priority archived',
        });
        break;

      case 'SCHEDULE_CHECK_IN':
        const daysFromNow = (decision as any).days_from_now || 14;

        actions.push({
          type: 'schedule_check_in',
          params: {
            days_from_now: daysFromNow,
            reason: decision.reason || 'Scheduled priority review',
          },
          reason: decision.reason || 'Check in on priorities',
        });
        break;

      case 'NO_ACTION':
        // No actions needed
        console.log('[Account Manager] No action needed:', decision.reason);
        break;

      default:
        console.warn('[Account Manager] Unknown action type:', decision.action);
    }

    return actions;
  } catch (error) {
    console.error('[Account Manager] Error parsing response:', error);
    console.error('[Account Manager] Response text:', responseText);
    return [];
  }
}

/**
 * Validates priority type
 */
export function isValidPriorityType(type: string): type is PriorityType {
  return type === 'goal' || type === 'challenge' || type === 'opportunity';
}

/**
 * Sanitizes priority content
 * - Trims whitespace
 * - Limits length
 * - Removes invalid characters
 */
export function sanitizePriorityContent(content: string): string {
  let sanitized = content.trim();

  // Limit to 500 characters
  if (sanitized.length > 500) {
    sanitized = sanitized.substring(0, 497) + '...';
  }

  // Remove control characters
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');

  return sanitized;
}

/**
 * Extracts confidence score from decision
 */
export function extractConfidence(decision: PriorityUpdateDecision): number {
  if (typeof decision.confidence === 'number') {
    return Math.max(0, Math.min(100, decision.confidence));
  }
  return 50; // Default medium confidence
}
