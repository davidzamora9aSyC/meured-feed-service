import { Body, Controller, Get, Headers, Post, Query, UnauthorizedException } from '@nestjs/common';
import { FeedService } from './feed.service';
import { getMeuredContext } from './feed.types';
import { IngestEventDto } from './dto/ingest-event.dto';

@Controller('feed')
export class FeedController {
  constructor(private readonly feedService: FeedService) {}

  @Get('me')
  listMyFeed(
    @Headers() headers: Record<string, string | undefined>,
    @Query('take') takeRaw?: string,
    @Query('before') beforeRaw?: string,
  ) {
    const take = Math.max(1, Math.min(parseInt(takeRaw ?? '20', 10) || 20, 50));
    const before = beforeRaw ? Number(beforeRaw) : undefined;
    return this.feedService.listMyFeed(this.context(headers), { take, before });
  }

  @Post('ingest')
  ingest(@Headers() headers: Record<string, string | undefined>, @Body() dto: IngestEventDto) {
    // Ingest HTTP se mantiene para debug/local; el camino principal es RabbitMQ consumer.
    return this.feedService.ingestEvent(this.context(headers), dto);
  }

  private context(headers: Record<string, string | undefined>) {
    try {
      const context = getMeuredContext(headers);
      if (context.activeProduct !== 'MEURED') throw new Error('Acceso MeuRed requerido');
      return context;
    } catch {
      throw new UnauthorizedException('Contexto MeuRed requerido');
    }
  }
}
