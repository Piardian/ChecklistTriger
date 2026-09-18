import { aggregateQuality } from '../src/setupIntelligenceEvaluator';

describe('aggregateQuality', () => {
  it('does not let one Medium supporting dimension erase broadly elite evidence', () => {
    expect(aggregateQuality(['High', 'Elite', 'Medium', 'High', 'Elite'])).toBe('Elite');
  });

  it('keeps a genuinely low dimension as a quality floor', () => {
    expect(aggregateQuality(['Elite', 'High', 'High', 'Low', 'Elite'])).toBe('Low');
  });

  it('requires multiple Elite dimensions before assigning Elite', () => {
    expect(aggregateQuality(['High', 'High', 'High', 'High', 'Medium'])).toBe('High');
  });

  it('fails closed for unavailable evidence', () => {
    expect(aggregateQuality(['Elite', 'High', 'Unknown', 'High', 'Elite'])).toBe('Invalid');
    expect(aggregateQuality(['Elite', 'High', 'Invalid', 'High', 'Elite'])).toBe('Invalid');
  });

  it('retains Medium for genuinely middling evidence', () => {
    expect(aggregateQuality(['Medium', 'High', 'Medium', 'High', 'Medium'])).toBe('Medium');
  });
});
