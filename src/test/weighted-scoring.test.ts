import { describe, it, expect } from 'vitest';
import { computeWeightedTotal, replaceScoreInFeedback, getCalibrationAnchors } from '@/lib/openai';

describe('computeWeightedTotal', () => {
  it('perfect scores produce 20 for all weight classes', () => {
    const perfect = { product_accuracy: 5, tone_rapport: 5, addressed_concern: 5, close_attempt: 5 };
    expect(computeWeightedTotal(perfect, 'fact_heavy')).toBe(20);
    expect(computeWeightedTotal(perfect, 'hybrid')).toBe(20);
    expect(computeWeightedTotal(perfect, 'rapport_heavy')).toBe(20);
  });

  it('all-1 scores produce 4 for all weight classes', () => {
    const worst = { product_accuracy: 1, tone_rapport: 1, addressed_concern: 1, close_attempt: 1 };
    expect(computeWeightedTotal(worst, 'fact_heavy')).toBe(4);
    expect(computeWeightedTotal(worst, 'hybrid')).toBe(4);
    expect(computeWeightedTotal(worst, 'rapport_heavy')).toBe(4);
  });

  it('fact_heavy penalizes low product_accuracy harder than hybrid', () => {
    const badFacts = { product_accuracy: 1, tone_rapport: 5, addressed_concern: 5, close_attempt: 5 };
    const factHeavy = computeWeightedTotal(badFacts, 'fact_heavy');
    const hybrid = computeWeightedTotal(badFacts, 'hybrid');
    expect(factHeavy).toBeLessThan(hybrid);
  });

  it('rapport_heavy penalizes low tone harder than hybrid', () => {
    const badTone = { product_accuracy: 5, tone_rapport: 1, addressed_concern: 5, close_attempt: 5 };
    const rapportHeavy = computeWeightedTotal(badTone, 'rapport_heavy');
    const hybrid = computeWeightedTotal(badTone, 'hybrid');
    expect(rapportHeavy).toBeLessThan(hybrid);
  });

  it('hybrid produces straight average (equal weights)', () => {
    const scores = { product_accuracy: 3, tone_rapport: 4, addressed_concern: 2, close_attempt: 5 };
    // hybrid: (3*5 + 4*5 + 2*5 + 5*5) / 5 = (15+20+10+25)/5 = 70/5 = 14
    expect(computeWeightedTotal(scores, 'hybrid')).toBe(14);
  });

  it('returns minimum 1 (safety floor)', () => {
    const scores = { product_accuracy: 1, tone_rapport: 1, addressed_concern: 1, close_attempt: 1 };
    expect(computeWeightedTotal(scores, 'hybrid')).toBeGreaterThanOrEqual(1);
  });

  it('fact_heavy: low PA with high others produces lower score than hybrid', () => {
    const scores = { product_accuracy: 2, tone_rapport: 5, addressed_concern: 4, close_attempt: 4 };
    // fact_heavy: (2*8 + 5*4 + 4*5 + 4*3) / 5 = (16+20+20+12)/5 = 68/5 = 13.6 -> 14
    // hybrid: (2*5 + 5*5 + 4*5 + 4*5) / 5 = (10+25+20+20)/5 = 75/5 = 15
    expect(computeWeightedTotal(scores, 'fact_heavy')).toBe(14);
    expect(computeWeightedTotal(scores, 'hybrid')).toBe(15);
  });
});

describe('replaceScoreInFeedback', () => {
  it('replaces score at start of feedback with weighted total', () => {
    expect(replaceScoreInFeedback('16/20. Wrong price on CR-V.', 14)).toBe('14/20. Wrong price on CR-V.');
  });

  it('handles single-digit scores', () => {
    expect(replaceScoreInFeedback('8/20. Missed key facts.', 6)).toBe('6/20. Missed key facts.');
  });

  it('does NOT replace N/20 in middle of feedback', () => {
    expect(replaceScoreInFeedback('16/20. Q1 was 4/20 level.', 14)).toBe('14/20. Q1 was 4/20 level.');
  });

  it('handles spaces around slash', () => {
    expect(replaceScoreInFeedback('16 / 20. Wrong trim.', 14)).toBe('14/20. Wrong trim.');
  });

  it('prepends weighted score if feedback does not start with N/20', () => {
    expect(replaceScoreInFeedback('Great job overall.', 18)).toBe('18/20. Great job overall.');
  });

  it('handles 20/20 perfect score', () => {
    expect(replaceScoreInFeedback('20/20. Nailed it.', 20)).toBe('20/20. Nailed it.');
  });

  it('handles empty string', () => {
    expect(replaceScoreInFeedback('', 14)).toBe('');
  });

  it('handles feedback with score not at start (GPT violation)', () => {
    expect(replaceScoreInFeedback('Excellent response: 16/20.', 14)).toBe('14/20. Excellent response: 16/20.');
  });

  it('handles feedback with multiple X/20 patterns', () => {
    expect(replaceScoreInFeedback('16/20. Q1: 4/20. Try: Improve.', 14)).toBe('14/20. Q1: 4/20. Try: Improve.');
  });
});

describe('computeWeightedTotal with invalid input', () => {
  it('falls back to hybrid for invalid weight class', () => {
    const scores = { product_accuracy: 3, tone_rapport: 4, addressed_concern: 2, close_attempt: 5 };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(computeWeightedTotal(scores, 'invalid_class' as any)).toBe(computeWeightedTotal(scores, 'hybrid'));
  });
});

describe('getCalibrationAnchors with injection attempt', () => {
  it('returns default for SQL-injection-like domain', () => {
    const result = getCalibrationAnchors("objection_handling; DROP TABLE--");
    expect(result).toEqual(getCalibrationAnchors('objection_handling'));
  });
});

describe('getCalibrationAnchors', () => {
  it('returns anchors for known domains', () => {
    const result = getCalibrationAnchors('objection_handling');
    expect(result.mediocre).toBeTruthy();
    expect(result.poor).toBeTruthy();
  });

  it('returns anchors for all five domains', () => {
    for (const domain of ['objection_handling', 'product_knowledge', 'closing_technique', 'competitive_positioning', 'financing']) {
      const result = getCalibrationAnchors(domain);
      expect(result.mediocre.length).toBeGreaterThan(20);
      expect(result.poor.length).toBeGreaterThan(20);
    }
  });

  it('returns default for null domain', () => {
    const result = getCalibrationAnchors(null);
    expect(result.mediocre).toBeTruthy();
    // Default is objection_handling
    expect(result).toEqual(getCalibrationAnchors('objection_handling'));
  });

  it('returns default for unknown domain', () => {
    const result = getCalibrationAnchors('nonexistent');
    expect(result.mediocre).toBeTruthy();
    expect(result).toEqual(getCalibrationAnchors('objection_handling'));
  });
});
