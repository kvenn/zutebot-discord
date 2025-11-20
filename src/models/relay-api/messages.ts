import { Type } from 'class-transformer';
import {
    IsDefined,
    IsObject,
    IsOptional,
    IsString,
    IsUrl,
    ValidateNested,
} from 'class-validator';

export class RelayAttachmentRequest {
    @IsOptional()
    @IsString()
    name?: string;

    @IsDefined()
    @IsUrl({ require_protocol: true })
    url: string;

    @IsOptional()
    @IsString()
    description?: string;
}

export class RelayMessageRequest {
    @IsDefined()
    @IsString()
    guildId: string;

    @IsDefined()
    @IsString()
    channelId: string;

    @IsOptional()
    @IsString()
    threadId?: string;

    @IsDefined()
    @IsObject()
    payload: Record<string, unknown>;

    @IsOptional()
    @ValidateNested({ each: true })
    @Type(() => RelayAttachmentRequest)
    attachments?: RelayAttachmentRequest[];
}
