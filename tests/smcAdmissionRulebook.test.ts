import {
  SMC_ADMISSION_RULEBOOK_VERSION,
  SMC_ADMISSION_RULES,
  getDistanceRule,
  getMinimumDisplacementGradePoints,
  getPoiTtlMs,
} from '../src/smcAdmissionRulebook';
import { detectAssetClass, getMinimumBoxSize } from '../src/assetMetrics';

describe('SMC admission rulebook', () => {
  it('is versioned and preserves the current admission policy', () => {
    expect(SMC_ADMISSION_RULEBOOK_VERSION).toBe('SmcAdmissionRulebook.v1');
    expect(getPoiTtlMs()).toBe(48 * 60 * 60 * 1000);
    expect(getMinimumDisplacementGradePoints()).toBe(1);
    expect(SMC_ADMISSION_RULES.distance.FOREX.maxUnits).toBe(35);
    expect(SMC_ADMISSION_RULES.distance.FOREX_JPY.maxUnits).toBe(50);
    expect(SMC_ADMISSION_RULES.distance.XAU.maxUnits).toBe(25);
    expect(SMC_ADMISSION_RULES.distance.XAU.maxPercent).toBe(0.60);
    expect(SMC_ADMISSION_RULES.distance.COMMODITY.maxPercent).toBe(1.0);
    expect(SMC_ADMISSION_RULES.distance.CRYPTO_INDEX.maxPercent).toBe(1.5);
  });

  it('selects distance rules deterministically by asset class', () => {
    expect(getDistanceRule('EURUSD', detectAssetClass('EURUSD'))).toEqual({ maxUnits: 35, maxPercent: null });
    expect(getDistanceRule('USDJPY', detectAssetClass('USDJPY'))).toEqual({ maxUnits: 50, maxPercent: null });
    expect(getDistanceRule('XAUUSD', detectAssetClass('XAUUSD'))).toEqual({ maxUnits: 25, maxPercent: 0.60 });
    expect(getDistanceRule('BTCUSD', detectAssetClass('BTCUSD'))).toEqual({ maxPercent: 1.5 });
    expect(getDistanceRule('NAS100', detectAssetClass('NAS100'))).toEqual({ maxPercent: 1.5 });
  });

  it('preserves current box-width policy through the rulebook', () => {
    expect(getMinimumBoxSize('EURUSD')).toEqual({ minUnits: 2.8 });
    expect(getMinimumBoxSize('CADUSD')).toEqual({ minUnits: 5.0 });
    expect(getMinimumBoxSize('EURJPY')).toEqual({ minUnits: 5.0 });
    expect(getMinimumBoxSize('USDJPY')).toEqual({ minUnits: 4.0 });
    expect(getMinimumBoxSize('XAUUSD')).toEqual({ minUnits: 25.0 });
    expect(getMinimumBoxSize('BTCUSD')).toEqual({ minUnits: 50.0, minPercent: 0.06 });
    expect(getMinimumBoxSize('ETHUSD')).toEqual({ minUnits: 0, minPercent: 0.25 });
    expect(getMinimumBoxSize('NAS100')).toEqual({ minUnits: 2.0, minPercent: 0.15 });
  });
});
