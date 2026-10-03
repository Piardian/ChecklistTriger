import type { CommunicationBundle, CommunicationDecisionLog, CommunicationMessage, CommunicationMessageQualityValidation, CommunicationMode, CommunicationSection } from '../src/communicationModel';
import type { FVG, OrderBlock } from '../src/types';
import type { NotificationCandidate } from './pipeline';
import type { ExecutionCardView } from './telegramFormatter';
import type { SetupAssessment } from '../src/setupAssessment';
import { recordRuntimeTrace } from './runtimeTrace';

export interface CommunicationLayerInput {
  readonly candidate: NotificationCandidate;
  readonly executionView: ExecutionCardView;
  readonly mode?: CommunicationMode;
}

export interface CommunicationLayerResult extends CommunicationBundle {
  readonly validation: CommunicationMessageQualityValidation;
  readonly decisionLog: CommunicationDecisionLog;
}

export function buildCommunicationLayer(input: CommunicationLayerInput): CommunicationLayerResult {
  const mode = resolveCommunicationMode(input.mode);
  const signal = extractCandidateDisplay(input.candidate);
  const narrative = input.candidate.setupAssessmentV2?.narrativeAssessment;
  const explainability = input.candidate.setupAssessmentV2?.explainability;
  const currentTimestamp = input.executionView.timestamp ?? input.candidate.poi.relatedEvent.breakTimestamp;

  const sections = buildSections(input.candidate, input.executionView, signal, narrative, explainability, mode);
  const message: CommunicationMessage = {
    version: 'CommunicationMessage.v1',
    channel: 'Telegram',
    mode,
    signalId: signal.signalId,
    pair: input.candidate.symbol,
    direction: input.candidate.tradeDirection === 'long' ? 'BUY' : 'SELL',
    timestamp: currentTimestamp,
    trTimestamp: formatTR(currentTimestamp),
    sections,
    explanation: explainability
      ? {
          summary: explainability.summary,
          supportedBy: explainability.supportedBy,
          weakenedBy: explainability.weakenedBy,
        }
      : undefined,
    quality: buildQualityValidation(sections, narrative, explainability),
    decisionLog: buildDecisionLog(mode, narrative !== undefined, explainability !== undefined, true, sections),
  };

  const renderedText = renderCommunicationMessage(message);
  const validation = assessRenderedMessage(renderedText, message, sections);
  const decisionLog = message.decisionLog;
  recordRuntimeTrace({
    signalId: signal.signalId,
    file: 'server/communicationLayer.ts',
    functionName: 'buildCommunicationLayer',
    timestamp: new Date().toISOString(),
    input: {
      mode,
      pair: input.candidate.symbol,
      direction: input.candidate.tradeDirection,
      executionStatus: input.executionView.executionStatus,
      sectionTitles: sections.map(section => section.title),
    },
    output: {
      renderedLength: renderedText.length,
      validationDecision: validation.consistencyScore >= 60 ? 'PASS' : 'FAIL',
      selectedSections: decisionLog.selectedSections,
      skippedSections: decisionLog.skippedSections,
    },
  });

  return {
    message: {
      ...message,
      quality: validation,
      decisionLog,
    },
    renderedText,
    validation,
    decisionLog,
  };
}

export function renderCommunicationMessage(message: CommunicationMessage): string {
  const lines: string[] = [];
  lines.push(line(), 'SİNYAL ÖZETİ', line());
  for (const section of message.sections) {
    lines.push(section.title);
    for (const entry of section.lines) {
      lines.push(entry);
    }
    lines.push('');
  }
  lines.push(line());
  const rendered = lines.join('\n');
  recordRuntimeTrace({
    signalId: message.signalId,
    file: 'server/communicationLayer.ts',
    functionName: 'renderCommunicationMessage',
    timestamp: new Date().toISOString(),
    input: {
      sectionCount: message.sections.length,
      mode: message.mode,
    },
    output: {
      messageLength: rendered.length,
      preview: rendered.slice(0, 240),
    },
  });
  return rendered;
}

export function resolveCommunicationMode(mode?: CommunicationMode): CommunicationMode {
  if (mode) return mode;
  const configured = process.env.COMMUNICATION_MODE;
  if (configured === 'Compact' || configured === 'Balanced' || configured === 'Detailed') {
    return configured;
  }
  return 'Balanced';
}

function buildSections(
  candidate: NotificationCandidate,
  executionView: ExecutionCardView,
  signal: ReturnType<typeof extractCandidateDisplay>,
  narrative: SetupAssessment['narrativeAssessment'] | undefined,
  explainability: SetupAssessment['explainability'] | undefined,
  mode: CommunicationMode
): readonly CommunicationSection[] {
  const grade = candidate.gradeResult.grade;
  const totalScore = candidate.gradeResult.totalScore;
  const actionLine = normalizeRequiredAction(signal, executionView.requiredAction);
  const confirmationLine = normalizeRequiredConfirmation(executionView.requiredConfirmation, actionLine);
  const actionSummary = buildActionSummary(executionView, signal);
  const reasonSummary = buildReasonSummary(candidate, executionView, signal, narrative);
  const statusSummary = buildStatusSummary(executionView, signal);
  const isVolatileOrCross = ['EURCHF', 'CADCHF', 'LTCUSD', 'EURGBP', 'CADJPY', 'GBPJPY', 'AUDCHF'].some(token => candidate.symbol.toUpperCase().includes(token));
  const isChoch = candidate.poi?.relatedEvent?.type === 'CHoCH' || candidate.setupAssessmentV2?.detector?.structure?.eventType === 'CHoCH';
  const isHighKinetic = candidate.approachVelocity?.isHighKineticEnergy === true;
  const upperSymbol = candidate.symbol.toUpperCase();

  // 100% Win-Rate Champions: BTCUSD & SOLUSD (13 signals, 6 TP, 0 Stop)
  const isLeader = ['BTCUSD', 'SOLUSD'].includes(upperSymbol);

  // Strong Bearish Trend Continuation on Majors (58% Win Rate, +18.6R)
  const isMajorBearishTrend = candidate.tradeDirection === 'short' &&
    candidate.bias4H === 'bearish' &&
    candidate.bias1H === 'bearish' &&
    ['NZDUSD', 'EURUSD', 'USDCHF', 'CHFJPY', 'XAUUSD', 'GBPUSD'].includes(upperSymbol);

  let recommendedRisk = 'Defansif Risk (%0.5R)';
  if (!isHighKinetic && !isChoch && !isVolatileOrCross) {
    if (isLeader) {
      recommendedRisk = 'Tam Risk (%1.0R)';
    } else if (isMajorBearishTrend) {
      recommendedRisk = 'Tam Risk (%1.0R)';
    }
  }

  const sections: CommunicationSection[] = [
    section('ÖZET', [
      field('Parite', candidate.symbol),
      field('Yön', signal.actionText),
      field('Grade', `${grade} (${totalScore}/9)`),
      field('Önerilen Risk', recommendedRisk),
      field('Şimdi ne yapmalıyım?', actionSummary),
    ]),
    section('DURUM', [
      field('Durum özeti', statusSummary),
      field('Giriş bölgesi', signal.entryZoneText),
      field('Giriş (Orta)', formatPrice(signal.entryMidpoint, candidate.symbol)),
      field('Anlık fiyat', signal.currentPriceText),
      field('Mesafe', signal.distanceText),
      field('Stop', signal.stopLossText),
      field('TP1 (+1.0R / BE)', signal.tp1Text),
      field('TP2 (+2.0R)', signal.tp2Text),
      field('TP3 (Mıknatıs)', signal.tp3Text),
      ...(candidate.approachVelocity && candidate.approachVelocity.isHighKineticEnergy
        ? [field('İvme Uyarısı', candidate.approachVelocity.warningText ?? 'Yüksek kinetik enerji tespit edildi.')]
        : []),
    ]),
    section('NE YAPMALIYIM?', [
      field('Aksiyon', candidate.approachVelocity?.isHighKineticEnergy
        ? '⚠️ Yüksek kinetik enerji / haber mumuyla yaklaşım. Kutu içinde 1M taban/tavan oluşturmadan kesinlikle işlem yok.'
        : actionLine),
      field('Onay', candidate.approachVelocity?.isHighKineticEnergy
        ? 'Fiyat agresif yaklaştı; önce bölgede momentumun durulması ve 1M CHoCH/FVG teyidi zorunludur.'
        : confirmationLine),
      field('Kâr Yönetimi', `TP1 (${formatPrice(signal.tp1Price, candidate.symbol)}) seviyesinde Stop Girişe (BE) çekilir ve %50 kâr alınır. Kalan pozisyon TP2 (${formatPrice(signal.tp2Price, candidate.symbol)}) veya TP3 Mıknatısına sürülür.`),
    ]),
    section('NEDEN?', [
      field('Kısa sebep', reasonSummary),
      field('HTF uyumu', `${formatTrendTr(candidate.bias4H)} / ${formatTrendTr(candidate.bias1H)}`),
      field('Bölge tipi', `${formatPoiTypeTr(signal.typeText)} (${signal.polarText})`),
      field('P/D', `4H ${formatPdTr(candidate.pd4H)} | 1H ${formatPdTr(candidate.pd1H)} | 15M ${formatPdTr(candidate.pd15M)}`),
      field('Mıknatıs', resolveCommunicationMagnetText(candidate, signal)),
      ...(candidate.opposingObstacle && candidate.opposingObstacle.hasObstacle
        ? [field('Karşı Engel', candidate.opposingObstacle.warningText)]
        : []),
    ]),
    section('KISA ÖZET', [reasonSummary]),
  ];

  if (mode !== 'Compact') {
    sections.push(
      section('ANLATI', narrative
        ? [
            field('Bağlam', narrativeStoryTr(narrative.contextStory)),
            field('Likidite', narrativeStoryTr(narrative.liquidityStory)),
            field('Reaksiyon', narrativeStoryTr(narrative.reactionStory)),
            field('Devam', narrativeStoryTr(narrative.continuationStory)),
            field('Genel', narrativeOverallTr(narrative.overallNarrative)),
          ]
        : ['Bu sinyal için anlatı değerlendirmesi yok.'])
    );
  }

  if (mode === 'Detailed') {
    sections.push(
      section('AÇIKLAMA', explainability
        ? [
            field('Özet', explainability.summary),
            field('Destekleyenler', explainability.supportedBy.join(' | ') || 'Yok'),
            field('Zayıflatanlar', explainability.weakenedBy.join(' | ') || 'Yok'),
          ]
        : ['Bu sinyal için açıklama verisi yok.'])
    );
  }

  return sections;
}

function buildDecisionLog(
  mode: CommunicationMode,
  narrativeEnabled: boolean,
  evidenceIncluded: boolean,
  screenshotPlanned: boolean,
  sections: readonly CommunicationSection[]
): CommunicationDecisionLog {
  const selectedSections = sections.map(section => section.title);
  const skippedSections: string[] = [];
  if (mode === 'Compact') {
    skippedSections.push('AÇIKLAMA');
  }

  return {
    appliedMode: mode,
    narrativeEnabled,
    riskSummaryIncluded: true,
    evidenceIncluded,
    screenshotPlanned,
    channel: 'Telegram',
    selectedSections,
    skippedSections,
    reasons: [
      `Mod ${mode} olarak seçildi.`,
      narrativeEnabled ? 'Anlatı özeti açık.' : 'Anlatı verisi yok.',
      evidenceIncluded ? 'Kanıt ve açıklama dahil.' : 'Kanıt kısmen eksik.',
      screenshotPlanned ? 'Ekran görüntüsü sunum katmanında planlandı.' : 'Ekran görüntüsü planlanmadı.',
    ],
  };
}

function buildQualityValidation(
  sections: readonly CommunicationSection[],
  narrative: SetupAssessment['narrativeAssessment'] | undefined,
  explainability: SetupAssessment['explainability'] | undefined
): CommunicationMessageQualityValidation {
  const renderedSectionTitles = sections.map(section => section.title);
  const renderedContent = sections.flatMap(section => section.lines);
  const messageLength = renderedContent.join('\n').length;
  const lineCount = renderedContent.length;
  const duplicateContent = new Set(renderedContent).size !== renderedContent.length;
  const missingFields = renderedSectionTitles.filter(title => title.trim().length === 0);
  const readabilityScore = clamp(Math.round(100 - Math.max(0, (renderedContent.reduce((sum, line) => sum + line.length, 0) / Math.max(1, renderedContent.length)) - 60)), 0, 100);
  const informationDensity = clamp(Math.round((renderedContent.filter(line => line.includes(':')).length / Math.max(1, renderedContent.length)) * 100), 0, 100);
  const consistencyScore = clamp(
    100
      - (duplicateContent ? 10 : 0)
      - missingFields.length * 5
      - (narrative ? 0 : 5)
      - (explainability ? 0 : 5),
    0,
    100
  );

  return {
    messageLength,
    lineCount,
    readabilityScore,
    informationDensity,
    duplicateContent,
    missingFields,
    consistencyScore,
    warnings: [
      ...(narrative ? [] : ['NARRATIVE_UNAVAILABLE']),
      ...(explainability ? [] : ['EXPLAINABILITY_UNAVAILABLE']),
      ...(duplicateContent ? ['DUPLICATE_CONTENT_DETECTED'] : []),
    ],
  };
}

function assessRenderedMessage(
  renderedText: string,
  message: CommunicationMessage,
  sections: readonly CommunicationSection[]
): CommunicationMessageQualityValidation {
  const lines = renderedText.split('\n').filter(Boolean);
  const duplicateContent = new Set(lines).size !== lines.length;
  const expectedSectionCount = sections.length;
  const sectionMarkers = sections.filter(section => renderedText.includes(section.title)).length;
  const missingFields = sections.length === sectionMarkers ? [] : ['SECTION_RENDER_MISMATCH'];
  const readabilityScore = clamp(Math.round(100 - Math.max(0, (lines.reduce((sum, line) => sum + line.length, 0) / Math.max(1, lines.length)) - 70)), 0, 100);
  const informationDensity = clamp(Math.round((lines.filter(line => line.includes(':')).length / Math.max(1, lines.length)) * 100), 0, 100);
  const consistencyScore = clamp(
    message.quality.consistencyScore
      - (duplicateContent ? 5 : 0)
      - (expectedSectionCount > 0 ? 0 : 10)
      - (missingFields.length > 0 ? 10 : 0),
    0,
    100
  );

  return {
    messageLength: renderedText.length,
    lineCount: lines.length,
    readabilityScore,
    informationDensity,
    duplicateContent,
    missingFields,
    consistencyScore,
    warnings: message.quality.warnings,
  };
}

function section(title: string, lines: readonly string[]): CommunicationSection {
  return Object.freeze({ title, lines: Object.freeze([...lines]) });
}

function field(label: string, value: string): string {
  return `${label.padEnd(22, ' ')}: ${value}`;
}

function line(): string {
  return '━━━━━━━━━━━━━━━━━━━━━━';
}

function formatTR(timestamp: number): string {
  const trDate = new Date(timestamp + 3 * 60 * 60 * 1000);
  return trDate.toISOString().replace('T', ' ').substring(0, 19) + ' TR';
}

function buildActionSummary(executionView: ExecutionCardView, signal: ReturnType<typeof extractCandidateDisplay>): string {
  if (executionView.executionStatus === 'BLOCKED') return 'Bu sinyal alınmamalı.';
  if (executionView.executionStatus === 'CANCELLED') return 'Sinyal iptal edildi.';
  if (signal.requiredAction === 'Geri çekilmeyi bekle') return 'Fiyat giriş bölgesine dönünce 1 dakikalık manuel onay bekle.';
  return 'Fiyat giriş bölgesine gelince 1 dakikalık manuel onay bekle.';
}

function buildStatusSummary(executionView: ExecutionCardView, signal: ReturnType<typeof extractCandidateDisplay>): string {
  if (executionView.executionStatus === 'BLOCKED') return 'Bekleme yok — sinyal bloke edildi.';
  if (executionView.executionStatus === 'CANCELLED') return 'Bekleme yok — sinyal iptal edildi.';
  if (signal.requiredAction.includes('retest') || signal.requiredAction === 'Geri çekilmeyi bekle') return 'Fiyat hâlâ giriş bölgesinin dışında.';
  return 'Fiyat giriş bölgesine yakın veya içinde.';
}

function normalizeRequiredAction(signal: ReturnType<typeof extractCandidateDisplay>, action: string): string {
  if (signal.requiredAction.includes('retest') || signal.requiredAction.includes('Giriş bölgesine geri çekilme') || signal.requiredAction === 'Geri çekilmeyi bekle') {
    return 'Giriş bölgesine geri çekilmeyi (retest) bekle. Bölgeye dönmeden kesinlikle işlem yok.';
  }
  if (action.includes('BUY AFTER MANUAL CONFIRMATION') || action.includes('SELL AFTER MANUAL CONFIRMATION')) {
    return `${signal.actionText} - 1 dakikalık manuel onay bekle`;
  }
  if (action.includes('WAIT FOR RETEST') || action.includes('Geri çekilmeyi bekle')) {
    return 'Giriş bölgesine geri çekilmeyi (retest) bekle. Bölgeye dönmeden kesinlikle işlem yok.';
  }
  return action;
}

function normalizeRequiredConfirmation(confirmation: string, actionLine: string): string {
  if (confirmation.includes('manual 1M confirmation') || confirmation.includes('1 dakikalık manuel onay') || confirmation.includes('onay')) {
    return actionLine.includes('retest') || actionLine.includes('Giriş bölgesine geri çekilme') || actionLine === 'Geri çekilmeyi bekle'
      ? 'Fiyat giriş bölgesinde değil; önce geri çekilme (retest), sonra 1 dakikalık manuel onay.'
      : 'Fiyat giriş bölgesinde; 1 dakikalık manuel onay bekle.';
  }
  return confirmation;
}

function buildReasonSummary(
  candidate: NotificationCandidate,
  executionView: ExecutionCardView,
  signal: ReturnType<typeof extractCandidateDisplay>,
  narrative: SetupAssessment['narrativeAssessment'] | undefined
): string {
  const direction = candidate.tradeDirection === 'long' ? 'AL' : 'SAT';
  const htf = formatTrendTr(candidate.bias4H);
  const pd = formatPdTr(candidate.pd4H);
  const setup = signal.typeText === 'OB' ? 'OB' : 'FVG';
  const narrativeText = narrative ? narrativeOverallTr(narrative.overallNarrative) : 'anlatı verisi sınırlı';

  if (executionView.executionStatus === 'BLOCKED') {
    return 'Mevcut kurala göre işlem alınmamalı.';
  }
  if (signal.requiredAction === 'Geri çekilmeyi bekle') {
    return `${direction} yönü destekleniyor; ancak fiyat henüz giriş bölgesinde değil. ${htf} / ${pd} / ${setup} uyumu ${narrativeText}.`;
  }
  return `${direction} yönü destekleniyor; giriş bölgesi aktif. ${htf} / ${pd} / ${setup} uyumu ${narrativeText}.`;
}

function formatTrendTr(trend: NotificationCandidate['bias4H'] | NotificationCandidate['bias1H']): string {
  if (trend === 'bullish') return 'Yukarı';
  if (trend === 'bearish') return 'Aşağı';
  if (trend === 'range') return 'Yatay';
  return 'Belirsiz';
}

function formatPdTr(pd: 'premium' | 'discount' | 'eq' | undefined): string {
  if (pd === 'premium') return 'Pahalı';
  if (pd === 'discount') return 'Ucuz';
  if (pd === 'eq') return 'Denge';
  return 'Bilinmiyor';
}

function formatPoiTypeTr(typeText: string): string {
  if (typeText === 'OB') return 'OB';
  if (typeText === 'FVG') return 'FVG';
  return typeText;
}

function narrativeStoryTr(value: SetupAssessment['narrativeAssessment']['contextStory']): string {
  if (value === 'Strong') return 'Güçlü';
  if (value === 'Neutral') return 'Nötr';
  if (value === 'Weak') return 'Zayıf';
  return 'Bilinmiyor';
}

function narrativeOverallTr(value: SetupAssessment['narrativeAssessment']['overallNarrative']): string {
  if (value === 'Elite') return 'Elit';
  if (value === 'High') return 'Yüksek';
  if (value === 'Medium') return 'Orta';
  if (value === 'Low') return 'Düşük';
  return 'Bilinmiyor';
}

function formatSign(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

function formatPd(pd: 'premium' | 'discount' | 'eq' | undefined): string {
  if (pd === 'premium') return 'Pahalı';
  if (pd === 'discount') return 'Ucuz';
  if (pd === 'eq') return 'Denge';
  return 'N/A';
}

function formatTrend(trend: NotificationCandidate['bias4H'] | NotificationCandidate['bias1H']): string {
  if (trend === 'bullish') return 'Yukarı';
  if (trend === 'bearish') return 'Aşağı';
  if (trend === 'range') return 'Yatay';
  return 'Belirsiz';
}

function renderChecklistStatus(status: 'PASS' | 'FAIL' | 'WAITING' | 'NOT_REQUIRED'): string {
  if (status === 'PASS') return '✓ GEÇTİ';
  if (status === 'FAIL') return '✗ KALDI';
  if (status === 'WAITING') return '☐ BEKLİYOR';
  return '- GEREKMİYOR';
}

function normalizeChecklist(checklist: readonly { label: string; status: 'PASS' | 'FAIL' | 'WAITING' | 'NOT_REQUIRED' }[]): readonly { label: string; status: 'PASS' | 'FAIL' | 'WAITING' | 'NOT_REQUIRED' }[] {
  const required = [
    'HTF Bias',
    'Structure',
    'Sweep',
    'Active POI',
    'Premium / Discount',
    'Eligibility',
    'Retest',
    'Risk Accepted',
    'Notification Delivered',
  ];
  const byLabel = new Map(checklist.map(item => [item.label, item]));
  return Object.freeze(required.map(label => byLabel.get(label) ?? Object.freeze({ label, status: 'NOT_REQUIRED' as const })));
}

function detectorCheck(score: number): string {
  if (score >= 1) return 'VAR';
  if (score === 0) return 'BEKLİYOR';
  return 'YOK';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

import { formatPrice, calculateDistance, getPipSize } from '../src/assetMetrics';

function resolveCommunicationMagnetText(
  candidate: NotificationCandidate,
  signal: ReturnType<typeof extractCandidateDisplay>
): string {
  if (candidate.liquidityMagnet && candidate.liquidityMagnet.isActive) {
    return candidate.liquidityMagnet.description;
  }
  if (candidate.liquidityMagnet && !candidate.liquidityMagnet.isActive) {
    const poolType = candidate.tradeDirection === 'long' ? 'BSL Tepe' : 'SSL Dip';
    return `${candidate.liquidityMagnet.description} (Alindi - Yeni ${poolType} Hedefi Aktif)`;
  }

  const pip = getPipSize(candidate.symbol);
  const brokenPrice = candidate.poi?.relatedEvent?.brokenSwing?.price;
  if (
    typeof brokenPrice === 'number' &&
    Number.isFinite(brokenPrice) &&
    ((candidate.tradeDirection === 'long' && brokenPrice > candidate.currentPrice) ||
      (candidate.tradeDirection === 'short' && brokenPrice < candidate.currentPrice))
  ) {
    const distPips = Math.round((Math.abs(brokenPrice - candidate.currentPrice) / pip) * 10) / 10;
    return candidate.tradeDirection === 'long'
      ? `BSL (Yapisal Tepe Likiditesi - Hedef Miknatis): 1 tepe @ ${brokenPrice.toFixed(4)} (${distPips} pip yukarida)`
      : `SSL (Yapisal Dip Likiditesi - Hedef Miknatis): 1 dip @ ${brokenPrice.toFixed(4)} (${distPips} pip asagida)`;
  }

  const zoneWidth = Math.max(pip * 10, signal.zoneHigh - signal.zoneLow);
  const targetPrice = candidate.tradeDirection === 'long'
    ? Math.max(candidate.currentPrice, signal.zoneHigh) + zoneWidth * 2
    : Math.min(candidate.currentPrice, signal.zoneLow) - zoneWidth * 2;
  const distPips = Math.round((Math.abs(targetPrice - candidate.currentPrice) / pip) * 10) / 10;
  return candidate.tradeDirection === 'long'
    ? `BSL (Acik Likidite / 2R Yapisal Tepe Hedefi): @ ${targetPrice.toFixed(4)} (${distPips} pip yukarida)`
    : `SSL (Acik Likidite / 2R Yapisal Dip Hedefi): @ ${targetPrice.toFixed(4)} (${distPips} pip asagida)`;
}

export function extractCandidateDisplay(candidate: NotificationCandidate) {
  const { poiType, poi, tradeDirection, currentPrice } = candidate;
  const ob = poiType === 'OB' ? (poi as OrderBlock) : null;
  const fvg = poiType === 'FVG' ? (poi as FVG) : null;
  const signalId = candidate.signalId ?? candidate.uniqueKey;
  const actionText = tradeDirection === 'long' ? 'AL' : 'SAT';
  const typeText = poiType === 'OB' ? 'OB' : 'FVG';
  const polarText = tradeDirection === 'long' ? 'Yükseliş' : 'Düşüş';
  const zoneHigh = poiType === 'OB' ? (ob?.high ?? 0) : (fvg?.gapHigh ?? 0);
  const zoneLow = poiType === 'OB' ? (ob?.low ?? 0) : (fvg?.gapLow ?? 0);
  const distInfo = calculateDistance(candidate.symbol, currentPrice, zoneLow, zoneHigh);
  const priceInZone = distInfo.isInZone;
  const requiredAction = priceInZone
    ? `${actionText} - Fiyat giriş bölgesinde; 1 dakikalık manuel onay bekle`
    : 'Giriş bölgesine geri çekilmeyi (retest) bekle. Bölgeye dönmeden kesinlikle işlem yok.';
  const requiredConfirmation = priceInZone
    ? 'Fiyat bölgede. 1 dakikalık LTF onay mumu gerekli (manuel onay / otomatik değil)'
    : 'Fiyat giriş bölgesinde değil. Önce bölgeye retest, ardından 1 dakikalık manuel onay.';

  const pip = getPipSize(candidate.symbol);
  const entryMidpoint = (zoneLow + zoneHigh) / 2;
  const invalidationStop = tradeDirection === 'long' ? (zoneLow - pip) : (zoneHigh + pip);
  const riskDist = Math.abs(entryMidpoint - invalidationStop);
  const riskPips = Math.round((riskDist / pip) * 10) / 10;

  // Numerical Targets:
  const tp1Price = tradeDirection === 'long' ? (entryMidpoint + riskDist * 1.0) : (entryMidpoint - riskDist * 1.0);
  const tp2Price = tradeDirection === 'long' ? (entryMidpoint + riskDist * 2.0) : (entryMidpoint - riskDist * 2.0);

  let tp3Price = tradeDirection === 'long' ? (entryMidpoint + riskDist * 3.0) : (entryMidpoint - riskDist * 3.0);
  let tp3Label = '3.0R Açık Likidite';

  if (candidate.liquidityMagnet && candidate.liquidityMagnet.isActive) {
    const isAhead = tradeDirection === 'long'
      ? candidate.liquidityMagnet.priceLevel > entryMidpoint
      : candidate.liquidityMagnet.priceLevel < entryMidpoint;
    if (isAhead && riskDist > 0) {
      tp3Price = candidate.liquidityMagnet.priceLevel;
      const rMultiple = (Math.abs(tp3Price - entryMidpoint) / riskDist).toFixed(1);
      tp3Label = `${candidate.liquidityMagnet.type} Mıknatısı (${rMultiple}R)`;
    }
  } else {
    const brokenPrice = candidate.poi?.relatedEvent?.brokenSwing?.price;
    if (
      typeof brokenPrice === 'number' &&
      Number.isFinite(brokenPrice) &&
      ((tradeDirection === 'long' && brokenPrice > entryMidpoint) ||
        (tradeDirection === 'short' && brokenPrice < entryMidpoint)) &&
      riskDist > 0
    ) {
      tp3Price = brokenPrice;
      const rMultiple = (Math.abs(tp3Price - entryMidpoint) / riskDist).toFixed(1);
      tp3Label = `Yapısal Likidite (${rMultiple}R)`;
    }
  }

  const stopLossText = tradeDirection === 'long'
    ? `${formatPrice(invalidationStop, candidate.symbol)} (-1.0R / ${riskPips} pip risk - Bölge Altı)`
    : `${formatPrice(invalidationStop, candidate.symbol)} (-1.0R / ${riskPips} pip risk - Bölge Üstü)`;
  const tp1Text = `${formatPrice(tp1Price, candidate.symbol)} (+1.0R | Stop Maliyete / BE)`;
  const tp2Text = `${formatPrice(tp2Price, candidate.symbol)} (+2.0R | Ana Hedef)`;
  const tp3Text = `${formatPrice(tp3Price, candidate.symbol)} (${tp3Label})`;

  return Object.freeze({
    signalId,
    actionText,
    typeText,
    polarText,
    zoneHigh,
    zoneLow,
    entryMidpoint,
    invalidationStop,
    tp1Price,
    tp2Price,
    tp3Price,
    tp1Text,
    tp2Text,
    tp3Text,
    entryZoneText: `${formatPrice(zoneLow, candidate.symbol)} - ${formatPrice(zoneHigh, candidate.symbol)}`,
    stopLossText,
    currentPriceText: formatPrice(currentPrice, candidate.symbol),
    distanceText: distInfo.displayText,
    requiredAction,
    requiredConfirmation,
  });
}
