import { calculateWilsonInterval } from '../src/binomialInterval';

test('Wilson interval is deterministic and bounded', () => {
  const interval = calculateWilsonInterval(60, 100);
  expect(interval).toEqual({
    method: 'WILSON_BINOMIAL_95',
    confidenceLevel: 0.95,
    successCount: 60,
    trialCount: 100,
    estimate: 0.6,
    lower: 0.502, 
    upper: 0.6915,
  });
});

test('invalid binomial inputs are rejected', () => {
  expect(calculateWilsonInterval(3, 0)).toBeUndefined();
  expect(calculateWilsonInterval(4, 3)).toBeUndefined();
  expect(calculateWilsonInterval(-1, 10)).toBeUndefined();
});
