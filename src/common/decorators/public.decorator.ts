import { SetMetadata } from '@nestjs/common';
export const IS_PUBLIC_KEY = 'isPublic';
/**
 * Marks an endpoint reachable without authentication. Authentication is global
 * and deny-by-default, so forgetting this makes an endpoint private — the safe
 * direction in which to fail.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
