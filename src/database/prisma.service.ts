import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/** The client type available inside an interactive transaction. */
export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Database connection established');
    } catch (error) {
      // Named explicitly: otherwise a wrong DATABASE_URL surfaces much later as
      // an unexplained failure on the first request.
      this.logger.error(
        `Could not connect to the database. Check DATABASE_URL in backend/.env. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Runs work in a transaction.
   *
   * Any state change that also writes an audit record must be atomic. An
   * approval with no audit trail is a compliance failure; an audit entry for an
   * approval that was rolled back is worse, because it asserts something untrue.
   */
  runInTransaction<T>(
    handler: (tx: PrismaTransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T> {
    return this.$transaction(handler, {
      maxWait: options?.maxWait ?? 5_000,
      timeout: options?.timeout ?? 20_000,
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  }
}
