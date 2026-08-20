import { SetMetadata } from '@nestjs/common';
export const PERMISSIONS_KEY = 'permissions';
/** Requires the caller to hold every listed permission code. */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
