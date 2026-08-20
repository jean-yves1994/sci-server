import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ClientMeta, CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { RequestMetadata, TenantContext } from '../common/tenant-context';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto, ForgotPasswordDto, LoginDto, RegisterDeviceDto, ResetPasswordDto,
} from './dto/auth.dto';

const REFRESH_COOKIE = 'sci_refresh';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email and password' })
  async login(
    @Body() dto: LoginDto,
    @ClientMeta() meta: RequestMetadata,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(dto, meta);
    this.setRefreshCookie(response, result.tokens.refreshToken);

    // The mobile client cannot use cookies reliably, so it also receives the
    // refresh token in the body and stores it in the platform keystore.
    return {
      user: result.user,
      accessToken: result.tokens.accessToken,
      refreshToken: dto.platform && dto.platform !== 'web' ? result.tokens.refreshToken : undefined,
      expiresIn: result.tokens.expiresIn,
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a refresh token for a new access token' })
  async refresh(
    @Req() request: Request,
    @Body() body: { refreshToken?: string },
    @ClientMeta() meta: RequestMetadata,
    @Res({ passthrough: true }) response: Response,
  ) {
    const cookies = request.cookies as Record<string, string> | undefined;
    const presented = body?.refreshToken ?? cookies?.[REFRESH_COOKIE] ?? '';

    const tokens = await this.authService.refresh(presented, meta);
    this.setRefreshCookie(response, tokens.refreshToken);

    return {
      accessToken: tokens.accessToken,
      refreshToken: body?.refreshToken ? tokens.refreshToken : undefined,
      expiresIn: tokens.expiresIn,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(
    @CurrentUser() user: TenantContext,
    @ClientMeta() meta: RequestMetadata,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logout(user, meta);
    response.clearCookie(REFRESH_COOKIE, { path: '/' });
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The signed-in user with roles and permissions' })
  me(@CurrentUser() user: TenantContext) {
    return this.authService.currentUser(user);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change your own password' })
  changePassword(
    @CurrentUser() user: TenantContext,
    @Body() dto: ChangePasswordDto,
    @ClientMeta() meta: RequestMetadata,
  ): Promise<void> {
    return this.authService.changePassword(user, dto, meta);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Request a password reset link' })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @ClientMeta() meta: RequestMetadata,
  ): Promise<{ message: string }> {
    await this.authService.requestPasswordReset(dto.email, meta);
    // Identical response whether or not the address exists.
    return { message: 'If that address has an account, a reset link has been sent.' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Complete a password reset' })
  resetPassword(
    @Body() dto: ResetPasswordDto,
    @ClientMeta() meta: RequestMetadata,
  ): Promise<void> {
    return this.authService.resetPassword(dto, meta);
  }

  @Post('devices')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Register a device for push notifications' })
  registerDevice(
    @CurrentUser() user: TenantContext,
    @Body() dto: RegisterDeviceDto,
  ): Promise<void> {
    return this.authService.registerDevice(user, dto.token, dto.platform, dto.deviceId);
  }

  /**
   * httpOnly so page scripts cannot read it, which removes the commonest way
   * tokens are stolen via XSS. Different localhost ports are still the same
   * site, so SameSite=Lax works in development without loosening it to None.
   */
  private setRefreshCookie(response: Response, token: string): void {
    response.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: Number(process.env.JWT_REFRESH_TTL_DAYS ?? 7) * 24 * 60 * 60 * 1000,
    });
  }
}
