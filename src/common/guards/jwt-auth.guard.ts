import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PrismaService } from '../../database/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ForbiddenError, UnauthorizedError } from '../errors/domain.exception';
import { ErrorCode } from '../errors/error-codes';
import { TenantContext } from '../tenant-context';

export interface AccessTokenPayload { sub: string; sid: string }

/**
 * Global authentication guard, applied to every route by default.
 *
 * The access token carries only a user id and a session id. Roles, permissions,
 * branch scope and account status are re-read from the database on each
 * request. That costs one indexed query and buys three properties that matter
 * in a regulated setting:
 *
 *   - Suspending an account takes effect on the next request, not at token
 *     expiry. Someone dismissed at 14:00 cannot approve at 14:12.
 *   - Permission changes apply immediately, with no forced re-login.
 *   - A stolen or forged token cannot carry elevated permissions, because
 *     permissions are never read from the token.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { tenant?: TenantContext }>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedError(
        ErrorCode.AUTH_TOKEN_INVALID,
        'Authentication is required to access this resource.',
      );
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token);
    } catch (error) {
      const expired = error instanceof Error && error.name === 'TokenExpiredError';
      throw new UnauthorizedError(
        expired ? ErrorCode.AUTH_TOKEN_EXPIRED : ErrorCode.AUTH_TOKEN_INVALID,
        expired
          ? 'Your session has expired. Please sign in again.'
          : 'The authentication token is invalid.',
      );
    }

    request.tenant = await this.buildTenantContext(payload);
    return true;
  }

  private async buildTenantContext(payload: AccessTokenPayload): Promise<TenantContext> {
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
      select: {
        id: true, status: true, organizationId: true, branchId: true,
        branchScope: true, lockedUntil: true,
        organization: { select: { status: true } },
        userRoles: {
          select: {
            role: {
              select: {
                code: true,
                rolePermissions: { select: { permission: { select: { code: true } } } },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedError(ErrorCode.AUTH_TOKEN_INVALID, 'The authentication token is invalid.');
    }

    if (user.status === 'DISABLED' || user.status === 'SUSPENDED') {
      throw new ForbiddenError(
        'This account is not currently active. Contact your administrator.',
        user.status === 'SUSPENDED' ? ErrorCode.AUTH_ACCOUNT_SUSPENDED : ErrorCode.AUTH_ACCOUNT_DISABLED,
      );
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenError('This account is temporarily locked.', ErrorCode.AUTH_ACCOUNT_LOCKED);
    }

    // A suspended institution locks out all of its users at once.
    if (user.organization.status !== 'ACTIVE') {
      throw new ForbiddenError('Your organization account is not active.', ErrorCode.AUTH_FORBIDDEN);
    }

    const session = await this.prisma.session.findFirst({
      where: { id: payload.sid, userId: user.id, revokedAt: null },
      select: { id: true, expiresAt: true },
    });

    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedError(
        ErrorCode.AUTH_SESSION_REVOKED,
        'This session has ended. Please sign in again.',
      );
    }

    const permissions = new Set<string>();
    const roles: string[] = [];
    for (const userRole of user.userRoles) {
      roles.push(userRole.role.code);
      for (const rp of userRole.role.rolePermissions) permissions.add(rp.permission.code);
    }

    return {
      userId: user.id,
      organizationId: user.organizationId,
      primaryBranchId: user.branchId,
      accessibleBranchIds: user.branchId ? [user.branchId] : [],
      branchScope: user.branchScope,
      permissions,
      roles,
      sessionId: session.id,
    };
  }

  private extractToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value : null;
  }
}
