import * as fs from 'fs';
import * as path from 'path';
import { CompletedSignalOutcomeEvidence, SignalEvidenceRecord, SignalPricePathEvidenceRecord } from '../src/signalEvidence';

export interface EvidenceStore {
  appendSignalEvidence(record: SignalEvidenceRecord): Promise<void>;
  appendOutcomeEvidence(record: CompletedSignalOutcomeEvidence): Promise<void>;
  appendPricePathEvidence?(record: SignalPricePathEvidenceRecord): Promise<void>;
}

export class JsonlEvidenceStore implements EvidenceStore {
  constructor(private readonly baseDir = process.env.EVIDENCE_DIRECTORY ?? 'evidence') {}

  async appendSignalEvidence(record: SignalEvidenceRecord): Promise<void> {
    this.appendSignalEvidenceSync(record);
  }

  async appendOutcomeEvidence(record: CompletedSignalOutcomeEvidence): Promise<void> {
    this.appendOutcomeEvidenceSync(record);
  }

  async appendPricePathEvidence(record: SignalPricePathEvidenceRecord): Promise<void> {
    this.appendPricePathEvidenceSync(record);
  }

  appendSignalEvidenceSync(record: SignalEvidenceRecord): void {
    appendJsonlSync(path.join(this.baseDir, 'signals', 'signal-evidence.jsonl'), record);
  }

  appendOutcomeEvidenceSync(record: CompletedSignalOutcomeEvidence): void {
    appendJsonlSync(path.join(this.baseDir, 'outcomes', 'outcome-evidence.jsonl'), record);
  }

  appendPricePathEvidenceSync(record: SignalPricePathEvidenceRecord): void {
    appendJsonlSync(path.join(this.baseDir, 'price-paths', 'price-path-evidence.jsonl'), record);
  }
}

function appendJsonlSync(filePath: string, record: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
}


