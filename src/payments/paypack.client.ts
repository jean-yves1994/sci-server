import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Paypack mobile money client.
 *
 * Paypack issues a short-lived access token from a merchant key/secret, then
 * accepts cashin requests against it. A cashin is asynchronous: the response is
 * always `pending`, because a human has to approve a prompt on their phone.
 * Settlement arrives by webhook, with polling as a fallback.
 */
@Injectable()
export class PaypackClient {
  private readonly logger = new Logger(PaypackClient.name);
  private readonly baseUrl = 'https://payments.paypack.rw/api';

  private token: string | null = null;
  private tokenExpiry = 0;

  constructor(private readonly config: ConfigService) {}

  /**
   * Authenticates, caching the token until shortly before it expires.
   *
   * The 60-second margin matters: a token that expires mid-flight fails a
   * payment request, and a failed payment request in front of a waiting client
   * is worse than an extra auth call.
   */
  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiry - 60_000) {
      return this.token;
    }

    const response = await fetch(`${this.baseUrl}/auth/agents/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.config.get<string>('PAYPACK_CLIENT_ID'),
        client_secret: this.config.get<string>('PAYPACK_CLIENT_SECRET'),
      }),
    });

    if (!response.ok) {
      throw new HttpException('Payment provider unavailable.', 502);
    }

    const data = (await response.json()) as { access: string; expires?: number };
    this.token = data.access;
    this.tokenExpiry = Date.now() + (data.expires ?? 900) * 1000;

    return this.token;
  }

  /**
   * Pushes a payment prompt to the customer's phone.
   *
   * The idempotency key is passed through to Paypack, so a retry after an
   * ambiguous timeout reaches the same transaction rather than charging twice.
   */
  async cashin(input: {
    amount: number;
    phoneNumber: string;
    idempotencyKey: string;
  }): Promise<{ ref: string; status: string }> {
    const token = await this.accessToken();

    const response = await fetch(`${this.baseUrl}/transactions/cashin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': input.idempotencyKey.slice(0, 32),
        'X-Webhook-Mode': this.config.get<string>('PAYPACK_MODE') ?? 'production',
      },
      body: JSON.stringify({
        amount: input.amount,
        number: input.phoneNumber,
      }),
    });

    const body = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      this.logger.warn(`Paypack cashin rejected: ${JSON.stringify(body)}`);
      throw new HttpException(
        typeof body.message === 'string' ? body.message : 'The payment request was rejected.',
        400,
      );
    }

    return { ref: body.ref as string, status: body.status as string };
  }

  /** Polls a transaction. Used to reconcile anything the webhook missed. */
  async find(ref: string): Promise<{ status: string } | null> {
    const token = await this.accessToken();

    const response = await fetch(`${this.baseUrl}/transactions/find/${ref}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

    if (!response.ok) return null;

    const body = (await response.json()) as Record<string, unknown>;
    return { status: body.status as string };
  }
}
