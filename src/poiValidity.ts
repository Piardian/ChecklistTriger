export function isPoiInvalidated(
  tradeDirection: 'long' | 'short',
  zoneLow: number,
  zoneHigh: number,
  validationClose: number,
  pipSize: number
): boolean {
  if (![zoneLow, zoneHigh, validationClose, pipSize].every(Number.isFinite)) {
    return true;
  }
  if (zoneHigh <= zoneLow || pipSize <= 0) {
    return true;
  }

  return tradeDirection === 'long'
    ? validationClose < zoneLow - pipSize
    : validationClose > zoneHigh + pipSize;
}
