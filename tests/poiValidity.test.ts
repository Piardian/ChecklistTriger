import { isPoiInvalidated } from '../src/poiValidity';

describe('POI invalidation', () => {
  const pip = 0.0001;

  test('long POI is invalidated only when completed close breaks below the zone with tolerance', () => {
    expect(isPoiInvalidated('long', 1.1000, 1.1010, 1.0999, pip)).toBe(false);
    expect(isPoiInvalidated('long', 1.1000, 1.1010, 1.0998, pip)).toBe(true);
  });

  test('short POI is invalidated only when completed close breaks above the zone with tolerance', () => {
    expect(isPoiInvalidated('short', 1.1000, 1.1010, 1.1011, pip)).toBe(false);
    expect(isPoiInvalidated('short', 1.1000, 1.1010, 1.1012, pip)).toBe(true);
  });

  test('malformed zone or invalid inputs are rejected safely', () => {
    expect(isPoiInvalidated('long', 1.1010, 1.1000, 1.1005, pip)).toBe(true);
    expect(isPoiInvalidated('long', Number.NaN, 1.1000, 1.1005, pip)).toBe(true);
    expect(isPoiInvalidated('long', 1.1000, 1.1010, 1.1005, 0)).toBe(true);
  });
});
