import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * Paypack mobile money client.
 *
 * Paypack is a USSD push, not a redirect checkout: `cashin` sends a prompt to
 * the customer's handset and returns immediately with `status: "pending"`.
 * The real outcome arrives later by webhook, or can be polled with `find`.
 *
 * Nothing in this class decides whether a fee is settled — it only speaks to
 * Paypack. The settlement decision lives in PaymentsService.
 */

export interface PaypackTransaction {
  ref: string;
  status: string;
  amount: number;
  kind: string;
  createdAt?: string;
}

export interface PaypackWebhookEvent {
  event_id?: string;
  kind?: string;
  created_at?: string;
  data?: {
    ref?: string;
    kind?: string;
    fee?: number;
    merchant?: string;
    client?: string;
    amount?: number;
    provider?: string;
    status?: string;
    created_at?: string;
    processed_at?: string;
  };
}

@Injectable()
export class PaypackService {
  private readonly logger = new Logger(PaypackService.name);

  private static readonly BASE_URL = 'https://payments.paypack.rw/api';

  /** Cached bearer token. Paypack tokens expire, so re-authenticating on
   *  every call would add a round-trip to each payment. */
  private token: string | null = null;
  private tokenExpiresAt = 0;

  private get clientId(): string {
    const v = process.env.PAYPACK_CLIENT_ID;
    if (!v) throw new Error('PAYPACK_CLIENT_ID is not set.');
    return v;
  }

  private get clientSecret(): string {
    const v = process.env.PAYPACK_CLIENT_SECRET;
    if (!v) throw new Error('PAYPACK_CLIENT_SECRET is not set.');
    return v;
  }

  private get mode(): string {
    return process.env.PAYPACK_MODE ?? 'development';
  }

  // ---------------------------------------------------------------- auth

  private async authenticate(): Promise<string> {
    // 60s of slack, so a token cannot expire mid-request.
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.token;
    }

    const response = await fetch(`${PaypackService.BASE_URL}/auth/agents/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Paypack authentication failed (${response.status}): ${body}`);
    }

    const json = (await response.json()) as { access: string; expires?: number };
    this.token = json.access;
    // Paypack tokens are short-lived; assume 15 minutes when unspecified.
    this.tokenExpiresAt = Date.now() + (json.expires ?? 900) * 1000;

    return this.token;
  }

  private async request<T>(
    path: string,
    init: { method: string; body?: unknown; idempotencyKey?: string },
  ): Promise<T> {
    const token = await this.authenticate();

    const response = await fetch(`${PaypackService.BASE_URL}${path}`, {
      method: init.method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Webhook-Mode': this.mode,
        ...(init.idempotencyKey
          ? // Paypack caps this at 32 characters.
            { 'Idempotency-Key': init.idempotencyKey.replace(/-/g, '').slice(0, 32) }
          : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Paypack ${init.method} ${path} failed (${response.status}): ${text}`);
    }

    return JSON.parse(text) as T;
  }

  // ------------------------------------------------------------ requests

  /**
   * Pushes a payment prompt to [phoneNumber].
   *
   * The returned status is ALWAYS `pending`. Treating it as confirmation
   * would let an inspector start work on an unpaid inspection, so callers
   * must wait for the webhook or poll [find].
   */
  async cashin(input: {
    amount: number;
    phoneNumber: string;
    idempotencyKey: string;
  }): Promise<PaypackTransaction> {
    const raw = await this.request<Record<string, unknown>>('/transactions/cashin', {
      method: 'POST',
      idempotencyKey: input.idempotencyKey,
      body: { amount: input.amount, number: input.phoneNumber },
    });

    return this.toTransaction(raw);
  }

  /** Authoritative status lookup, used for reconciliation when a webhook is
   *  lost — which does happen. */
  async find(ref: string): Promise<PaypackTransaction> {
    const raw = await this.request<Record<string, unknown>>(
      `/transactions/find/${encodeURIComponent(ref)}`,
      { method: 'GET' },
    );
    return this.toTransaction(raw);
  }

  private toTransaction(raw: Record<string, unknown>): PaypackTransaction {
    const data = (raw.data as Record<string, unknown> | undefined) ?? raw;

    return {
      ref: String(data.ref ?? ''),
      status: String(data.status ?? 'pending').toLowerCase(),
      amount: Number(data.amount ?? 0),
      kind: String(data.kind ?? 'CASHIN'),
      createdAt: data.created_at ? String(data.created_at) : undefined,
    };
  }

  // ----------------------------------------------------- webhook security

  /**
   * Verifies a webhook signature.
   *
   * ⚠️ UNVERIFIED IMPLEMENTATION.
   *
   * Paypack's documentation states that a signature header accompanies each
   * delivery and is "a hash of the payload and a secret key", but the page
   * describing the exact header name and digest encoding is not publicly
   * reachable. HMAC-SHA256 over the raw body, base64-encoded, is the
   * near-universal convention and is what this implements.
   *
   * To confirm: register a Development-mode webhook pointing at a request
   * capture service, run one test cashin, and read the headers Paypack
   * actually sends. Then correct the constants below — the algorithm is
   * isolated here so that is a one-line change rather than a refactor.
   */
  static readonly SIGNATURE_HEADER = 'x-paypack-signature';

  verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
    const secret = process.env.PAYPACK_WEBHOOK_SECRET;

    if (!secret) {
      // Refusing is the safe direction: an unverified webhook could mark any
      // inspection as paid.
      this.logger.error('PAYPACK_WEBHOOK_SECRET is not set; rejecting webhook.');
      return false;
    }

    if (!signature) return false;

    const expected = createHmac('sha256', secret).update(rawBody).digest('base64');

    const received = Buffer.from(signature);
    const computed = Buffer.from(expected);

    // Length check first: timingSafeEqual throws on a mismatch.
    if (received.length !== computed.length) return false;

    return timingSafeEqual(received, computed);
  }

  /** Idempotency keys are capped at 32 characters by Paypack. */
  static newIdempotencyKey(): string {
    return randomUUID().replace(/-/g, '').slice(0, 32);
  }
}
