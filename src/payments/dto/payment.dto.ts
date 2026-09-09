import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class RequestFeeDto {
  @ApiProperty({
    description:
      "The property owner's mobile money number. A payment prompt is pushed " +
      'to this handset for approval.',
    example: '0788123456',
  })
  @IsString()
  @IsNotEmpty({ message: 'A mobile money number is required.' })
  @MaxLength(20)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/[\s\-()]/g, '') : value,
  )
  // Permissive here; PaymentsService.normalisePhone does the strict check so
  // the rule lives in one place.
  @Matches(/^(\+?250|0)?7[2389]\d{7}$/, {
    message: 'Enter a valid Rwandan mobile money number, for example 0788123456.',
  })
  phoneNumber!: string;
}
