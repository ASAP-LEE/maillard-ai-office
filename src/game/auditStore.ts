// src/game/auditStore.ts
import { AuditLogEntry } from './agentPipeline';

export class AuditStore {
  private logs: AuditLogEntry[] = [];

  public addLog(entry: AuditLogEntry): void {
    this.logs.push(entry);
  }

  public getLogs(): AuditLogEntry[] {
    return [...this.logs];
  }

  public clearLogs(): void {
    this.logs = [];
  }
  
  public getLogById(id: string): AuditLogEntry | undefined {
    return this.logs.find(log => log.id === id);
  }
}

export const auditStore = new AuditStore();
