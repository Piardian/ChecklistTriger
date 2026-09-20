import { detectLiquidityMagnet } from '../src/liquidityMagnetDetector';
import { SwingPoint } from '../src/types';

describe('Liquidity Magnet Detector (EQH / EQL)', () => {
  it('detects EQH (Equal Highs) above current price for long trade', () => {
    const swings: SwingPoint[] = [
      { type: 'high', price: 1.0550, formedAtIndex: 10, confirmedAtIndex: 12, timestamp: 1000 },
      { type: 'low', price: 1.0500, formedAtIndex: 15, confirmedAtIndex: 17, timestamp: 2000 },
      { type: 'high', price: 1.0551, formedAtIndex: 20, confirmedAtIndex: 22, timestamp: 3000 }, // ~1 pip diff
    ];
    const currentPrice = 1.0520;

    const magnet = detectLiquidityMagnet(swings, currentPrice, 'long', 'EURUSD');
    expect(magnet).not.toBeNull();
    expect(magnet?.type).toBe('EQH');
    expect(magnet?.pointsCount).toBe(2);
    expect(magnet?.isActive).toBe(true);
    expect(magnet?.distancePips).toBeCloseTo(30.5, 0.5);
    expect(magnet?.description).toContain('EQH');
  });

  it('detects EQL (Equal Lows) below current price for short trade', () => {
    const swings: SwingPoint[] = [
      { type: 'high', price: 195.0, formedAtIndex: 10, confirmedAtIndex: 12, timestamp: 1000 },
      { type: 'low', price: 192.50, formedAtIndex: 15, confirmedAtIndex: 17, timestamp: 2000 },
      { type: 'low', price: 192.52, formedAtIndex: 20, confirmedAtIndex: 22, timestamp: 3000 }, // 2 points diff
    ];
    const currentPrice = 193.50;

    const magnet = detectLiquidityMagnet(swings, currentPrice, 'short', 'CHFJPY');
    expect(magnet).not.toBeNull();
    expect(magnet?.type).toBe('EQL');
    expect(magnet?.pointsCount).toBe(2);
    expect(magnet?.isActive).toBe(true);
    expect(magnet?.distancePips).toBeCloseTo(99, 1);
    expect(magnet?.description).toContain('EQL');
  });

  it('selects the nearest active equal-high cluster instead of the first detected cluster', () => {
    const swings: SwingPoint[] = [
      { type: 'high', price: 1.0600, formedAtIndex: 10, confirmedAtIndex: 12, timestamp: 1000 },
      { type: 'high', price: 1.0601, formedAtIndex: 12, confirmedAtIndex: 14, timestamp: 2000 },
      { type: 'low', price: 1.0550, formedAtIndex: 15, confirmedAtIndex: 17, timestamp: 3000 },
      { type: 'high', price: 1.0560, formedAtIndex: 18, confirmedAtIndex: 20, timestamp: 4000 },
      { type: 'high', price: 1.0561, formedAtIndex: 21, confirmedAtIndex: 23, timestamp: 5000 },
    ];

    const magnet = detectLiquidityMagnet(swings, 1.0500, 'long', 'EURUSD');

    expect(magnet).not.toBeNull();
    expect(magnet?.type).toBe('EQH');
    expect(magnet?.priceLevel).toBeCloseTo(1.05605, 5);
    expect(magnet?.distancePips).toBeCloseTo(60.5, 0.5);
  });



  it('marks an equal-high cluster as taken when liquidity was breached after formation but before late confirmation', () => {
    const swings: SwingPoint[] = [
      { type: 'high', price: 1.0550, formedAtIndex: 10, confirmedAtIndex: 12, timestamp: 1000 },
      { type: 'high', price: 1.0551, formedAtIndex: 20, confirmedAtIndex: 25, timestamp: 2000 },
    ];
    const candles = Array.from({ length: 31 }, (_, index) => ({
      timestamp: index * 1000,
      high: 1.0530,
      low: 1.0510,
    }));
    candles[21].high = 1.0560; // Liquidity is taken before the second swing is confirmed.

    const magnet = detectLiquidityMagnet(
      swings,
      1.0520,
      'long',
      'EURUSD',
      candles,
      30
    );

    expect(magnet).not.toBeNull();
    expect(magnet?.isActive).toBe(false);
    expect(magnet?.status).toBe('TAKEN');
    expect(magnet?.firstTakenAt).toBe(21000);
  });

  it('returns null when swings are too dispersed to be equal', () => {
    const swings: SwingPoint[] = [
      { type: 'high', price: 1.0550, formedAtIndex: 10, confirmedAtIndex: 12, timestamp: 1000 },
      { type: 'high', price: 1.0580, formedAtIndex: 20, confirmedAtIndex: 22, timestamp: 3000 }, // 30 pips diff
    ];
    const currentPrice = 1.0520;

    const magnet = detectLiquidityMagnet(swings, currentPrice, 'long', 'EURUSD');
    expect(magnet).toBeNull();
  });
});
