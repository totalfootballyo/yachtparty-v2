/**
 * Test Reporter
 *
 * Saves conversation transcripts and judge scores to disk for human review.
 * Creates markdown files with formatted results in Testing/transcripts/
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { JudgeScore } from './JudgeAgent';

export interface TestReport {
  transcript: string;
  judgeScore: JudgeScore;
  toolsUsed: string[];
  messagesExchanged: number;
  durationMs: number;
  user?: any;
  conversation?: any;
}

export class TestReporter {
  private transcriptsDir: string;

  constructor() {
    this.transcriptsDir = path.join(__dirname, '../transcripts');
  }

  /**
   * Saves a test transcript and scores to a markdown file.
   *
   * @param testName - Name of the test (e.g., "bouncer-eager-eddie")
   * @param report - Test report with transcript and scores
   */
  async saveTranscript(testName: string, report: TestReport): Promise<string> {
    // Create directory for today's date
    const dateDir = path.join(this.transcriptsDir, this.getDateString());
    await fs.mkdir(dateDir, { recursive: true });

    // Generate filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${testName}-${timestamp}.md`;
    const filepath = path.join(dateDir, filename);

    // Format content
    const content = this.formatTranscript(testName, report);

    // Write to file
    await fs.writeFile(filepath, content, 'utf-8');

    console.log(`✅ Transcript saved: ${filepath}`);
    return filepath;
  }

  /**
   * Saves a summary of all test scores to a JSON file.
   *
   * @param testResults - Map of test names to reports
   */
  async saveSummary(testResults: Map<string, TestReport>): Promise<string> {
    const dateDir = path.join(this.transcriptsDir, this.getDateString());
    await fs.mkdir(dateDir, { recursive: true });

    const summary = {
      date: new Date().toISOString(),
      totalTests: testResults.size,
      results: Array.from(testResults.entries()).map(([name, report]) => ({
        testName: name,
        judgeScore: report.judgeScore.overall,
        tone: report.judgeScore.tone,
        flow: report.judgeScore.flow,
        completeness: report.judgeScore.completeness,
        errors: report.judgeScore.errors.length,
        messagesExchanged: report.messagesExchanged,
        durationMs: report.durationMs,
      })),
      averageScore: this.calculateAverage(testResults, 'overall'),
      averageTone: this.calculateAverage(testResults, 'tone'),
      averageFlow: this.calculateAverage(testResults, 'flow'),
      averageCompleteness: this.calculateAverage(testResults, 'completeness'),
      totalErrors: Array.from(testResults.values()).reduce(
        (sum, r) => sum + r.judgeScore.errors.length,
        0
      ),
    };

    const filepath = path.join(dateDir, 'summary.json');
    await fs.writeFile(filepath, JSON.stringify(summary, null, 2), 'utf-8');

    console.log(`✅ Summary saved: ${filepath}`);
    return filepath;
  }

  /**
   * Formats a test report as markdown.
   */
  private formatTranscript(testName: string, report: TestReport): string {
    const { judgeScore, transcript, toolsUsed, messagesExchanged, durationMs } = report;

    return `# ${testName}

**Date:** ${new Date().toISOString()}

## Judge Scores

| Metric | Score |
|--------|-------|
| **Overall** | ${judgeScore.overall.toFixed(2)} |
| Tone | ${judgeScore.tone.toFixed(2)} |
| Flow | ${judgeScore.flow.toFixed(2)} |
| Completeness | ${judgeScore.completeness.toFixed(2)} |

${judgeScore.errors.length > 0 ? `
### Critical Errors (${judgeScore.errors.length})

${judgeScore.errors.map(err => `- ${err}`).join('\n')}
` : '### No Critical Errors ✅'}

### Judge Reasoning

${judgeScore.reasoning}

## Test Metadata

- **Messages Exchanged:** ${messagesExchanged}
- **Duration:** ${(durationMs / 1000).toFixed(2)}s
- **Tools Used:** ${toolsUsed.length > 0 ? toolsUsed.join(', ') : 'None'}

---

## Conversation Transcript

${transcript}

---

## User Data

${report.user ? `
- **ID:** ${report.user.id}
- **Phone:** ${report.user.phone_number || 'Not provided'}
- **Email:** ${report.user.email || 'Not provided'}
- **Email Verified:** ${report.user.email_verified || false}
- **Verified:** ${report.user.verified}
- **Name:** ${report.user.first_name || ''} ${report.user.last_name || ''}
- **Company:** ${report.user.company || 'Not provided'}
- **Title:** ${report.user.title || 'Not provided'}
` : 'Not available'}

## Conversation Data

${report.conversation ? `
- **ID:** ${report.conversation.id}
- **Status:** ${report.conversation.status}
` : 'Not available'}
`;
  }

  /**
   * Gets today's date as a string (YYYY-MM-DD).
   */
  private getDateString(): string {
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Calculates average score across all test results.
   */
  private calculateAverage(
    testResults: Map<string, TestReport>,
    metric: 'overall' | 'tone' | 'flow' | 'completeness'
  ): number {
    const values = Array.from(testResults.values()).map(r => r.judgeScore[metric]);
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  /**
   * Reads all transcripts from a specific date.
   */
  async getTranscriptsForDate(date: string): Promise<string[]> {
    const dateDir = path.join(this.transcriptsDir, date);

    try {
      const files = await fs.readdir(dateDir);
      return files.filter(f => f.endsWith('.md'));
    } catch (error) {
      return [];
    }
  }

  /**
   * Gets list of all dates with transcripts.
   */
  async getAvailableDates(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.transcriptsDir, { withFileTypes: true });
      return entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort()
        .reverse(); // Most recent first
    } catch (error) {
      return [];
    }
  }
}
