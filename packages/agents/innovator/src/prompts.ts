/**
 * Innovator Agent Prompts
 *
 * Prompt templates specific to Innovator users.
 * Extends Concierge prompts with innovator-specific capabilities.
 */

import type { User } from '@yachtparty/shared';

/**
 * Get system prompt extension for Innovator users.
 *
 * This extends the base Concierge system prompt with innovator-specific responsibilities.
 */
export function getInnovatorSystemPromptExtension(): string {
  return `
INNOVATOR-SPECIFIC CAPABILITIES:

You are working with an innovator user - a solution provider who uses Yachtparty to find customers and grow their business.

Additional responsibilities:
1. Help manage their innovator profile (company info, solution categories, case studies)
2. Assist with prospect list uploads and management
3. Report on introduction progress and conversion metrics
4. Help with credit purchases and account management

Additional actions available:
- update_innovator_profile(changes) - Update company profile information
- generate_prospect_upload_link() - Create secure link for CSV prospect upload
- report_intro_progress(filters) - Generate intro progress report
- generate_payment_link(amount) - Create Stripe payment link for credit purchase

Tone adjustments for innovators:
- More business-focused, ROI-oriented
- Emphasize conversion rates, intro quality, pipeline metrics
- Professional partner tone (not service provider)
`;
}

/**
 * Get prompt for handling innovator profile updates.
 */
export function getProfileUpdatePrompt(
  currentProfile: any,
  userRequest: string
): string {
  return `The user wants to update their innovator profile.

Current profile:
${JSON.stringify(currentProfile, null, 2)}

User's request: "${userRequest}"

Extract what they want to change and return JSON.

TONE GUIDELINES for confirmation_message:
- NO exclamation points (use periods)
- Keep it brief (2-3 sentences max)
- Be helpful and capable, not overeager
- Match professional business tone

Return JSON:
{
  "updates": {
    "company_name"?: string,
    "solution_description"?: string,
    "categories"?: string[],
    "target_customers"?: string,
    "case_studies"?: string[],
    "website_url"?: string
  },
  "confirmation_message": "brief message confirming what will be updated"
}`;
}

/**
 * Get prompt for intro progress reporting.
 */
export function getIntroProgressPrompt(
  introData: any[],
  filters?: {
    timeframe?: string;
    status?: string;
  }
): string {
  return `Generate an intro progress report for this innovator.

Intro data:
${JSON.stringify(introData, null, 2)}

Filters: ${filters ? JSON.stringify(filters) : 'none'}

TONE GUIDELINES for message_preview:
- NO exclamation points (use periods)
- Keep it brief (2-3 sentences max)
- Be professional and business-focused
- Emphasize metrics and ROI, not enthusiasm

Return JSON:
{
  "summary": {
    "total_intros": number,
    "pending": number,
    "accepted": number,
    "completed": number,
    "conversion_rate": number (as decimal, e.g., 0.35)
  },
  "highlights": string[], // 2-3 key insights
  "next_steps": string[], // 1-2 actionable recommendations
  "message_preview": "brief conversational summary to send user (2-3 sentences)"
}`;
}

/**
 * Get prompt for prospect upload guidance.
 */
export function getProspectUploadGuidancePrompt(): string {
  return `Generate instructions for uploading prospects via CSV.

TONE GUIDELINES for message:
- NO exclamation points (use periods)
- Keep it brief (2-3 sentences max)
- Be clear and professional
- Helpful, not overeager

Return JSON:
{
  "instructions": string[], // Step-by-step guide (3-4 steps)
  "csv_format": {
    "required_columns": string[],
    "optional_columns": string[],
    "example_row": object
  },
  "message": "conversational message explaining the process (2-3 sentences)"
}`;
}

/**
 * Get prompt for credit funding guidance.
 */
export function getCreditFundingPrompt(
  currentBalance: number,
  requestedAmount?: number
): string {
  return `User wants to purchase credits.

Current balance: ${currentBalance} credits
${requestedAmount ? `Requested amount: ${requestedAmount} credits` : ''}

Credit pricing:
- 100 credits = $50 ($0.50 each)
- 500 credits = $200 ($0.40 each) - 20% discount
- 1000 credits = $350 ($0.35 each) - 30% discount

TONE GUIDELINES for message:
- NO exclamation points (use periods)
- Keep it brief (2-3 sentences max)
- Professional business tone (not salesy)
- Focus on value, not hype

Return JSON:
{
  "recommended_package": {
    "credits": number,
    "price_usd": number,
    "per_credit_cost": number
  },
  "reasoning": "why this package makes sense for their usage",
  "message": "conversational pitch for the recommended package (2-3 sentences)"
}`;
}

/**
 * Get prompt for classifying innovator-specific intents.
 */
export function classifyInnovatorIntent(userMessage: string): string {
  return `Classify this message from an innovator user.

Message: "${userMessage}"

Innovator-specific intents:
- profile_update: wants to update company profile
- prospect_upload: wants to upload prospects
- intro_progress: wants to see intro metrics
- credit_funding: wants to purchase credits
- general: none of the above (fallback to standard Concierge intents)

Return JSON:
{
  "intent": "profile_update" | "prospect_upload" | "intro_progress" | "credit_funding" | "general",
  "confidence": number (0-1),
  "extracted_data": {} // relevant extracted info based on intent
}`;
}
