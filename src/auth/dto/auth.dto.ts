import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'inspector@sci.rw' })
  @IsEmail({}, { message: 'Enter a valid email address.' })
  email: string;

  @ApiProperty()
  @IsString() @IsNotEmpty({ message: 'Password is required.' })
  password: string;

  @ApiPropertyOptional({ enum: ['android', 'ios', 'web'] })
  @IsIn(['android', 'ios', 'web']) @IsOptional()
  platform?: string;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({ description: 'Policy enforced server-side; see password.util.ts.' })
  @IsString() @IsNotEmpty() @MaxLength(200)
  newPassword: string;
}

export class ForgotPasswordDto {
  @ApiProperty() @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty() @IsString() @IsNotEmpty()
  token: string;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200)
  newPassword: string;
}

export class RegisterDeviceDto {
  @ApiProperty() @IsString() @IsNotEmpty()
  token: string;

  @ApiProperty({ enum: ['android', 'ios'] })
  @IsIn(['android', 'ios'])
  platform: string;

  @ApiPropertyOptional() @IsString() @IsOptional()
  deviceId?: string;
}
