# SMC_MATHEMATICAL_AUDIT_REPORT.md

## 1. Market Structure (Swing High/Low, BOS, CHoCH)
- **Risk:** Fraktal tepe/dip tespitinde `lookback` penceresi sabit tutulursa, volatilite değişimlerinde "off-by-one" hatası oluşur.
- **Öneri:** `is_swing_high = (high[i-1] > high[i-2]) and (high[i-1] > high[i])`. Gövde (body) kapanışları için `close` bazlı teyit eklenmelidir.

## 2. FVG (Fair Value Gap)
- **Matematik:** `fvg_size = abs(low[i] - high[i-2])`. 
- **Risk:** `low[i] > high[i-2]` durumu "gap" değil "overlap"tır. 
- **Optimizasyon:** `if (low[i] > high[i-2]) and (close[i-1] > high[i-2])` gibi bir hacim filtresi eklenmelidir.

## 3. Order Block (OB) & Mean Threshold
- **Matematik:** `MT = (high + low) / 2`. 
- **Risk:** `high` ve `low` değerleri çok yakınsa (doji), OB geçersiz sayılmalıdır.

## 4. OTE (Optimal Trade Entry)
- **Formül:** `OTE_Zone = [0.618, 0.786]`. 
- **Risk:** `(high - low) * 0.618 + low`. 
- **Hassasiyet:** `Decimal` kütüphanesi kullanılmalı, `float` hassasiyet kaybı önlenmelidir.

## 5. Risk & Lookahead Bias
- **Uyarı:** MTF (Multi-Timeframe) verilerinde `i` indisini `i+1` ile karşılaştırmak "lookahead bias" yaratır. `i-1` her zaman bir önceki kapalı barı temsil etmelidir.
