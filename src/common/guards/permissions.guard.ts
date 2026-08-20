import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { ForbiddenError } from '../errors/domain.exception';
import { ErrorCode } from '../errors/error-codes';
import { TenantContext } from '../tenant-context';

/**
 * Enforces @RequirePermissions. Runs after JwtAuthGuard, so the permission set
 * it reads is the freshly loaded one rather than anything carried in the token.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & { tenant?: TenantContext }>();
    const user = request.tenant;

    if (!user) throw new ForbiddenError('Authentication is required.', ErrorCode.AUTH_FORBIDDEN);

    const missing = required.filter((p) => !user.permissions.has(p));
    if (missing.length > 0) {
      // The specific missing permission is deliberately not echoed back; it
      // would map the authorisation model for anyone probing endpoints.
      throw new ForbiddenError(
        'You do not have permission to perform this action.',
        ErrorCode.AUTH_FORBIDDEN,
      );
    }
    return true;
  }
}
