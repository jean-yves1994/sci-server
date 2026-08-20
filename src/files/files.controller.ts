import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Query,
  Res,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { StorageProvider } from '../providers/storage/storage.provider';

/**
 * Serves stored objects behind a signed, expiring URL.
 *
 * Marked @Public deliberately: authorisation is carried by the HMAC signature
 * rather than a bearer token, which is what lets an <img> tag or a PDF viewer
 * load the object directly. The signature covers the key, the expiry and the
 * disposition, so none of them can be altered after the URL is issued.
 *
 * This injects the abstract StorageProvider rather than a concrete class, so it
 * works unchanged whether STORAGE_DRIVER is 'local' or 'blob'. The alternative —
 * injecting both providers and re-deciding here — would put the same decision
 * in two places, and two copies of one rule eventually disagree.
 */
@ApiTags('Files')
@Controller('files')
export class FilesController {
  private readonly logger = new Logger(FilesController.name);

  constructor(private readonly storage: StorageProvider) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Fetch a stored object using a signed URL' })
  @ApiExcludeEndpoint()
  async get(
    @Query('key') key: string,
    @Query('expires') expires: string,
    @Query('nonce') nonce: string,
    @Query('disposition') disposition: string,
    @Query('signature') signature: string,
    @Res() response: Response,
  ): Promise<void> {
    if (!key || !expires || !nonce || !signature) {
      throw new BadRequestException('This link is incomplete.');
    }

    const valid = this.storage.verifySignature(
      key,
      Number(expires),
      nonce,
      disposition ?? 'inline',
      signature,
    );

    if (!valid) {
      // One message for both a forged signature and an expired link.
      // Distinguishing them would tell someone probing for a signing weakness
      // whether their forgery was structurally correct but merely stale.
      throw new BadRequestException('This link is invalid or has expired.');
    }

    let body: Buffer;
    try {
      body = await this.storage.get(key);
    } catch (error) {
      // The signature was valid, so the key was one this system issued. A
      // failure here means the object is genuinely gone — worth logging,
      // because on a serverless host it is the signature of ephemeral storage.
      this.logger.warn(
        `Signed request for "${key}" could not be served: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new NotFoundException('The requested file is no longer available.');
    }

    response.setHeader('Content-Type', contentTypeFor(key));
    response.setHeader('Content-Length', body.byteLength);

    // Private: these are inspection photographs and collateral reports, and a
    // shared cache must never hold them. max-age is short and bounded by the
    // signature's own expiry regardless.
    response.setHeader('Cache-Control', 'private, max-age=300');

    // Belt and braces against a browser sniffing a different type from the
    // bytes and rendering something executable.
    response.setHeader('X-Content-Type-Options', 'nosniff');

    response.setHeader(
      'Content-Disposition',
      `${disposition === 'attachment' ? 'attachment' : 'inline'}; filename="${safeFilename(key)}"`,
    );

    response.send(body);
  }
}

/**
 * Content type is derived from the key, not from anything the caller sent.
 * The key is server-generated and its extension was chosen from the file's
 * verified magic number at upload time, so it is trustworthy here.
 */
function contentTypeFor(key: string): string {
  const extension = key.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'pdf':
      return 'application/pdf';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    default:
      // Unknown extensions download rather than render, so an unexpected object
      // cannot be coaxed into executing in the browser.
      return 'application/octet-stream';
  }
}

/**
 * Strips anything that could break out of the quoted filename in the
 * Content-Disposition header. Keys are server-generated, but a header
 * injection here would be worth having only once.
 */
function safeFilename(key: string): string {
  const base = key.split('/').pop() ?? 'download';
  return base.replace(/[^\w.-]/g, '_');
}
