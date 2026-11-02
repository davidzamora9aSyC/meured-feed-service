import { IsOptional, IsString, MaxLength } from 'class-validator';

export class IngestEventDto {
  @IsString()
  @MaxLength(80)
  type!: string;

  @IsString()
  actorAuthUserId!: string;

  @IsString()
  objectType!: string;

  @IsString()
  objectId!: string;

  @IsOptional()
  payload?: unknown;
}

