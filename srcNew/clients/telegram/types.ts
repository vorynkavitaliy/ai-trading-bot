export interface SendOptions {
  raw?: boolean;
  disablePreview?: boolean;
}

export interface SendOutcome {
  readonly chatId: string;
  readonly ok: boolean;
  readonly error?: string;
}

export interface BroadcastOutcome {
  readonly outcomes: ReadonlyArray<SendOutcome>;
  readonly okCount: number;
  readonly failCount: number;
}
