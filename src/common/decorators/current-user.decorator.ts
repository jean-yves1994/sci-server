import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';
import { RequestMetadata, TenantContext } from '../tenant-context';

/** Injects the security context assembled by JwtAuthGuard. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<Request & { tenant?: TenantContext }>();
  return request.tenant as TenantContext;
});

/** Injects client metadata for audit records. */
export const ClientMeta = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<Request>();
  const meta: RequestMetadata = {
    ipAddress: request.ip,
    userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : undefined,
    deviceId: typeof request.headers['x-device-id'] === 'string' ? request.headers['x-device-id'] : undefined,
  };
  return meta;
});
