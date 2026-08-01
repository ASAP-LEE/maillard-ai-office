// src/game/auditStore.ts
import { AuditLogEntry } from "./agentPipeline";

let auditEntries: AuditLogEntry[] = [];
let idCounter = 0;
type Subscriber = () => void;
const subscribers: Subscriber[] = [];

export function nextAuditId(): string {
  idCounter++;
  return `audit_${Date.now()}_${idCounter}`;
}

export function addAuditEntry(entry: AuditLogEntry): void {
  auditEntries.push(entry);
  subscribers.forEach((sub) => sub());
}

export function getAuditEntries(): AuditLogEntry[] {
  return [...auditEntries];
}

export function subscribeAudit(callback: Subscriber): () => void {
  subscribers.push(callback);
  return () => {
    const idx = subscribers.indexOf(callback);
    if (idx > -1) subscribers.splice(idx, 1);
  };
}
