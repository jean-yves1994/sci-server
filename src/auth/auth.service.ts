import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { BadRequestError, ForbiddenError, UnauthorizedError } from '../common/errors/domain.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  checkPasswordPolicy,
  generateToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from '../common/utils/password.util';
import { RequestMetadata, TenantContext } from '../common/tenant-context';
import { PrismaService, PrismaTransactionClient } from '../database/prisma.service';
import { ChangePasswordDto, LoginDto, ResetPasswordDto } from './dto/auth.dto';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const PASSWORD_RESET_TTL_MINUTES = 30;

/**
 * A syntactically valid hash of a value nobody knows.
 *
 * Verifying against this when the email is unknown spends roughly the same CPU
 * as a real check. Without it an unknown address returns measurably faster than
 * a wrong password, turning login into an oracle for discovering who banks with
 * the institution.
 */
const DUMMY_HASH = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;

export interface AuthTokens { accessToken: string; refreshToken: string; expiresIn: number }

export interface AuthenticatedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  organizationId: string;
  branchId: string | null;
  branchScope: string;
  mustChangePassword: boolean;
  roles: string[];
  permissions: string[];
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async login(
    dto: LoginDto,
    meta: RequestMetadata,
  ): Promise<{ user: AuthenticatedUser; tokens: AuthTokens }> {
    const email = dto.email.trim().toLowerCase();

    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      include: {
        organization: { select: { id: true, status: true } },
        userRoles: {
          include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
        },
      },
    });

    if (!user) {
      await verifyPassword(DUMMY_HASH, dto.password);
      throw new UnauthorizedError(
        ErrorCode.AUTH_INVALID_CREDENTIALS,
        'The email address or password is incorrect.',
      );
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new ForbiddenError(
        `This account is locked after repeated failed attempts. Try again in ${minutes} minute(s).`,
        ErrorCode.AUTH_ACCOUNT_LOCKED,
      );
    }

    if (user.status === 'DISABLED' || user.status === 'SUSPENDED') {
      throw new ForbiddenError(
        'This account is not currently active. Contact your administrator.',
        user.status === 'SUSPENDED'
          ? ErrorCode.AUTH_ACCOUNT_SUSPENDED
          : ErrorCode.AUTH_ACCOUNT_DISABLED,
      );
    }

    if (user.organization.status !== 'ACTIVE') {
      throw new ForbiddenError('Your organization account is not active.', ErrorCode.AUTH_FORBIDDEN);
    }

    if (!(await verifyPassword(user.passwordHash, dto.password))) {
      await this.registerFailedAttempt(user.id, user.failedLoginAttempts, user.organizationId, meta);
      throw new UnauthorizedError(
        ErrorCode.AUTH_INVALID_CREDENTIALS,
        'The email address or password is incorrect.',
      );
    }

    const tokens = await this.prisma.runInTransaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastLoginAt: new Date(),
          // A first successful sign-in completes activation of a seeded account.
          status: user.status === 'PENDING_ACTIVATION' ? 'ACTIVE' : user.status,
        },
      });

      const session = await tx.session.create({
        data: {
          userId: user.id,
          userAgent: meta.userAgent ?? null,
          ipAddress: meta.ipAddress ?? null,
          deviceId: meta.deviceId ?? null,
          platform: dto.platform ?? null,
          expiresAt: this.refreshExpiry(),
        },
      });

      const refreshToken = await this.issueRefreshToken(tx, user.id, session.id, randomUUID());
      const accessToken = await this.signAccessToken(user.id, session.id);

      await this.audit.record(
        {
          organizationId: user.organizationId,
          userId: user.id,
          action: 'AUTH_LOGIN_SUCCEEDED',
          entityType: 'User',
          entityId: user.id,
          meta,
        },
        tx,
      );

      return { accessToken, refreshToken, expiresIn: this.accessTtlSeconds() };
    });

    return { user: this.toAuthenticatedUser(user), tokens };
  }

  /**
   * Exchanges a refresh token for a new pair, invalidating the old one.
   *
   * Rotation limits a stolen token's usefulness to the window before the real
   * client next refreshes. Presenting an already-spent token means the token was
   * either stolen or the client is broken; both justify ending the session
   * rather than guessing which, so the whole family is revoked.
   */
  async refresh(presentedToken: string, meta: RequestMetadata): Promise<AuthTokens> {
    if (!presentedToken) {
      throw new UnauthorizedError(
        ErrorCode.AUTH_TOKEN_INVALID,
        'Your session has expired. Please sign in again.',
      );
    }

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(presentedToken) },
      include: {
        user: { select: { id: true, status: true, organizationId: true, deletedAt: true } },
      },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedError(
        ErrorCode.AUTH_TOKEN_INVALID,
        'Your session has expired. Please sign in again.',
      );
    }

    if (stored.usedAt) {
      await this.prisma.runInTransaction(async (tx) => {
        await tx.refreshToken.updateMany({
          where: { familyId: stored.familyId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'REUSE_DETECTED' },
        });
        await tx.session.updateMany({
          where: { id: stored.sessionId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await this.audit.record(
          {
            organizationId: stored.user.organizationId,
            userId: stored.userId,
            action: 'AUTH_REFRESH_REUSE_DETECTED',
            entityType: 'Session',
            entityId: stored.sessionId,
            meta,
          },
          tx,
        );
      });

      this.logger.warn(`Refresh token reuse detected for user ${stored.userId}; family revoked`);
      throw new UnauthorizedError(
        ErrorCode.AUTH_SESSION_REVOKED,
        'This session has ended. Please sign in again.',
      );
    }

    if (
      stored.user.deletedAt ||
      stored.user.status === 'DISABLED' ||
      stored.user.status === 'SUSPENDED'
    ) {
      throw new ForbiddenError('This account is no longer active.', ErrorCode.AUTH_ACCOUNT_DISABLED);
    }

    const session = await this.prisma.session.findFirst({
      where: { id: stored.sessionId, revokedAt: null },
      select: { id: true, expiresAt: true },
    });

    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedError(
        ErrorCode.AUTH_SESSION_REVOKED,
        'This session has ended. Please sign in again.',
      );
    }

    return this.prisma.runInTransaction(async (tx) => {
      await tx.refreshToken.update({
        where: { id: stored.id },
        data: { usedAt: new Date(), revokedAt: new Date(), revokedReason: 'ROTATED' },
      });

      const refreshToken = await this.issueRefreshToken(
        tx,
        stored.userId,
        stored.sessionId,
        stored.familyId,
      );

      await tx.session.update({ where: { id: stored.sessionId }, data: { lastSeenAt: new Date() } });

      const accessToken = await this.signAccessToken(stored.userId, stored.sessionId);
      return { accessToken, refreshToken, expiresIn: this.accessTtlSeconds() };
    });
  }

  async logout(user: TenantContext, meta: RequestMetadata): Promise<void> {
    await this.prisma.runInTransaction(async (tx) => {
      await tx.session.updateMany({
        where: { id: user.sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.refreshToken.updateMany({
        where: { sessionId: user.sessionId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'LOGOUT' },
      });
      await this.audit.record(
        {
          organizationId: user.organizationId,
          userId: user.userId,
          action: 'AUTH_LOGOUT',
          entityType: 'Session',
          entityId: user.sessionId,
          meta,
        },
        tx,
      );
    });
  }

  async changePassword(
    user: TenantContext,
    dto: ChangePasswordDto,
    meta: RequestMetadata,
  ): Promise<void> {
    const record = await this.prisma.user.findFirst({
      where: { id: user.userId, deletedAt: null },
      select: { id: true, passwordHash: true },
    });

    if (!record) {
      throw new UnauthorizedError(ErrorCode.AUTH_TOKEN_INVALID, 'Account not found.');
    }

    if (!(await verifyPassword(record.passwordHash, dto.currentPassword))) {
      throw new BadRequestError(
        ErrorCode.AUTH_INVALID_CREDENTIALS,
        'Your current password is incorrect.',
      );
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestError(
        ErrorCode.BAD_REQUEST,
        'The new password must differ from the current one.',
      );
    }

    this.assertPasswordPolicy(dto.newPassword);
    const passwordHash = await hashPassword(dto.newPassword);

    await this.prisma.runInTransaction(async (tx) => {
      await tx.user.update({
        where: { id: record.id },
        data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() },
      });

      // Every other device authenticated with the old password.
      await tx.session.updateMany({
        where: { userId: record.id, revokedAt: null, id: { not: user.sessionId } },
        data: { revokedAt: new Date() },
      });
      await tx.refreshToken.updateMany({
        where: { userId: record.id, revokedAt: null, sessionId: { not: user.sessionId } },
        data: { revokedAt: new Date(), revokedReason: 'PASSWORD_CHANGED' },
      });

      await this.audit.record(
        {
          organizationId: user.organizationId,
          userId: user.userId,
          action: 'AUTH_PASSWORD_CHANGED',
          entityType: 'User',
          entityId: user.userId,
          meta,
        },
        tx,
      );
    });
  }

  /**
   * Begins a password reset.
   *
   * Always reports success, whether or not the address exists. Saying "no such
   * account" here would leak exactly what the vague login message protects.
   */
  async requestPasswordReset(emailRaw: string, meta: RequestMetadata): Promise<void> {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: { id: true, organizationId: true },
    });

    if (!user) return;

    const token = generateToken();

    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60_000),
      },
    });

    await this.audit.record({
      organizationId: user.organizationId,
      userId: user.id,
      action: 'AUTH_PASSWORD_RESET_REQUESTED',
      entityType: 'User',
      entityId: user.id,
      meta,
    });

    // Delivery is a mail-provider concern in production. In development the
    // token is logged so the flow can be exercised end to end without email.
    this.logger.log(`Password reset token for ${email}: ${token}`);
  }

  async resetPassword(dto: ResetPasswordDto, meta: RequestMetadata): Promise<void> {
    const record = await this.prisma.passwordReset.findUnique({
      where: { tokenHash: hashToken(dto.token) },
      include: { user: { select: { id: true, organizationId: true, deletedAt: true } } },
    });

    if (!record || record.usedAt || record.expiresAt < new Date() || record.user.deletedAt) {
      throw new BadRequestError(
        ErrorCode.AUTH_TOKEN_INVALID,
        'This password reset link is invalid or has expired.',
      );
    }

    this.assertPasswordPolicy(dto.newPassword);
    const passwordHash = await hashPassword(dto.newPassword);

    await this.prisma.runInTransaction(async (tx) => {
      await tx.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });

      await tx.passwordReset.update({ where: { id: record.id }, data: { usedAt: new Date() } });

      // A reset usually follows a suspected compromise, so every session goes.
      await tx.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'PASSWORD_RESET' },
      });

      await this.audit.record(
        {
          organizationId: record.user.organizationId,
          userId: record.userId,
          action: 'AUTH_PASSWORD_RESET_COMPLETED',
          entityType: 'User',
          entityId: record.userId,
          meta,
        },
        tx,
      );
    });
  }

  async currentUser(user: TenantContext): Promise<AuthenticatedUser> {
    const record = await this.prisma.user.findFirst({
      where: { id: user.userId, deletedAt: null },
      include: {
        organization: { select: { id: true, status: true } },
        userRoles: {
          include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
        },
      },
    });

    if (!record) {
      throw new UnauthorizedError(ErrorCode.AUTH_TOKEN_INVALID, 'Account not found.');
    }
    return this.toAuthenticatedUser(record);
  }

  /** Registers a device for push notifications. */
  async registerDevice(
    user: TenantContext,
    token: string,
    platform: string,
    deviceId?: string,
  ): Promise<void> {
    await this.prisma.deviceToken.upsert({
      where: { token },
      update: {
        userId: user.userId,
        lastSeenAt: new Date(),
        revokedAt: null,
        deviceId: deviceId ?? null,
      },
      create: { userId: user.userId, token, platform, deviceId: deviceId ?? null },
    });
  }

  // -------------------------------------------------------------------------

  private assertPasswordPolicy(password: string): void {
    const result = checkPasswordPolicy(password);
    if (!result.valid) {
      throw new BadRequestError(
        ErrorCode.AUTH_PASSWORD_POLICY,
        `The password must ${result.failures.join(', ')}.`,
        result.failures,
      );
    }
  }

  private async registerFailedAttempt(
    userId: string,
    currentAttempts: number,
    organizationId: string,
    meta: RequestMetadata,
  ): Promise<void> {
    const attempts = currentAttempts + 1;
    const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
      },
    });

    await this.audit.record({
      organizationId,
      userId,
      action: shouldLock ? 'AUTH_ACCOUNT_LOCKED' : 'AUTH_LOGIN_FAILED',
      entityType: 'User',
      entityId: userId,
      metadata: { attempts },
      meta,
    });
  }

  private async issueRefreshToken(
    tx: PrismaTransactionClient,
    userId: string,
    sessionId: string,
    familyId: string,
  ): Promise<string> {
    const token = generateToken();

    await tx.refreshToken.create({
      data: {
        userId,
        sessionId,
        familyId,
        // Only the hash is stored, so a database leak yields no usable tokens.
        tokenHash: hashToken(token),
        expiresAt: this.refreshExpiry(),
      },
    });

    return token;
  }

  private signAccessToken(userId: string, sessionId: string): Promise<string> {
    return this.jwtService.signAsync({ sub: userId, sid: sessionId });
  }

  private accessTtlSeconds(): number {
    const raw = this.config.get<string>('JWT_ACCESS_TTL') ?? '15m';
    const match = /^(\d+)([smhd])$/.exec(raw.trim());
    if (!match) return 900;

    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3_600, d: 86_400 };
    return Number(match[1]) * (multipliers[match[2]] ?? 60);
  }

  private refreshExpiry(): Date {
    const days = Number(this.config.get<string>('JWT_REFRESH_TTL_DAYS') ?? 7);
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private toAuthenticatedUser(user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    organizationId: string;
    branchId: string | null;
    branchScope: string;
    mustChangePassword: boolean;
    userRoles: Array<{
      role: { code: string; rolePermissions: Array<{ permission: { code: string } }> };
    }>;
  }): AuthenticatedUser {
    const permissions = new Set<string>();
    for (const userRole of user.userRoles) {
      for (const rp of userRole.role.rolePermissions) permissions.add(rp.permission.code);
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      organizationId: user.organizationId,
      branchId: user.branchId,
      branchScope: user.branchScope,
      mustChangePassword: user.mustChangePassword,
      roles: user.userRoles.map((ur) => ur.role.code),
      permissions: [...permissions],
    };
  }
}
