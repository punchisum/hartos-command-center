export interface ActionTokenRecord {
  tok: string;
  actionCode: string;
  entityType: string;
  entityId: string | null;
  telegramChatId: string;
  telegramUserId: string;
  payload: Record<string, unknown>;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface ActionTokenStore {
  save(record: ActionTokenRecord): Promise<void>;
  find(tok: string): Promise<ActionTokenRecord | null>;
  markConsumed(tok: string, consumedAt: Date): Promise<void>;
}

export class InMemoryActionTokenStore implements ActionTokenStore {
  private readonly records = new Map<string, ActionTokenRecord>();

  async save(record: ActionTokenRecord): Promise<void> {
    this.records.set(record.tok, record);
  }

  async find(tok: string): Promise<ActionTokenRecord | null> {
    return this.records.get(tok) ?? null;
  }

  async markConsumed(tok: string, consumedAt: Date): Promise<void> {
    const record = this.records.get(tok);
    if (record) record.consumedAt = consumedAt;
  }
}

export function assertCallbackDataSafe(callbackData: string): void {
  if (new TextEncoder().encode(callbackData).length > 64) {
    throw new Error("Telegram callback_data exceeds 64 bytes");
  }
  if (!callbackData.startsWith("tok:")) {
    throw new Error("Unsupported callback token format");
  }
}

export async function issueActionToken(
  store: ActionTokenStore,
  input: Omit<ActionTokenRecord, "tok" | "consumedAt">
): Promise<ActionTokenRecord> {
  const tok = crypto.randomUUID().replaceAll("-", "").slice(0, 20);
  const callbackData = `tok:${tok}`;
  assertCallbackDataSafe(callbackData);

  const record: ActionTokenRecord = { ...input, tok, consumedAt: null };
  await store.save(record);
  return record;
}

export async function validateActionToken(
  store: ActionTokenStore,
  tok: string,
  now = new Date()
): Promise<ActionTokenRecord> {
  const record = await store.find(tok);
  if (!record) throw new Error("Action token not found");
  if (record.consumedAt) throw new Error("Action token already consumed");
  if (record.expiresAt.getTime() <= now.getTime()) throw new Error("Action token expired");
  return record;
}

export async function runApprovedAction(
  store: ActionTokenStore,
  tok: string,
  action: (record: ActionTokenRecord) => Promise<void>
): Promise<void> {
  const record = await validateActionToken(store, tok);
  await action(record);
  await store.markConsumed(tok, new Date());
}
