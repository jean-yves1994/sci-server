import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class RequestFeeDto {
  @ApiProperty({
    example: '0788123456',
    description: "The client's mobile money number, in local format.",
  })
  @IsString()
  // MTN (078, 079) and Airtel (072, 073) prefixes in Rwanda. Validated here as
  // well as on the device: a client-side check is a convenience, not a control.
  @Matches(/^0(78|79|72|73)\d{7}$/, {
    message: 'Enter a valid Rwandan mobile number, for example 0788123456.',
  })
  phoneNumber!: string;
}
