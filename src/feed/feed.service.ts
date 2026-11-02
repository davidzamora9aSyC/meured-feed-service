import { BadRequestException, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { MeuredContext } from './feed.types';
import { IngestEventDto } from './dto/ingest-event.dto';
import { PrismaService } from '../prisma/prisma.service';

type FeedItem = {
  id: string;
  type: string;
  actorAuthUserId: string;
  objectType: string;
  objectId: string;
  createdAtMs: number;
  payload?: unknown;
};

type IngestEventInput = {
  type: string;
  actorAuthUserId: string;
  objectType: string;
  objectId: string;
  payload?: unknown;
  occurredAt?: string;
};

@Injectable()
export class FeedService {
  private readonly redis: Redis;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const redisUrl = config.get<string>('REDIS_URL') ?? 'redis://redis:6379';
    this.redis = new Redis(redisUrl);
  }

  async ingestEvent(_context: MeuredContext, dto: IngestEventDto) {
    return this.ingestFromEvent({
      type: dto.type,
      actorAuthUserId: dto.actorAuthUserId,
      objectType: dto.objectType,
      objectId: dto.objectId,
      payload: dto.payload ?? undefined,
    });
  }

  async ingestFromEvent(input: IngestEventInput) {
    const type = input.type.trim();
    if (!type) throw new BadRequestException('type requerido');
    if (!input.actorAuthUserId || !input.objectType || !input.objectId) {
      throw new BadRequestException('actorAuthUserId/objectType/objectId requeridos');
    }

    const createdAtMs = Date.now();
    const id = `${createdAtMs}:${Math.random().toString(16).slice(2)}`;
    const item: FeedItem = {
      id,
      type,
      actorAuthUserId: input.actorAuthUserId,
      objectType: input.objectType,
      objectId: input.objectId,
      createdAtMs,
      payload: input.payload ?? undefined,
    };

    await this.prisma.meuredTimelineEvent.create({
      data: {
        type,
        actorAuthUserId: input.actorAuthUserId,
        objectType: input.objectType,
        objectId: input.objectId,
        payloadJson: input.payload ?? undefined,
      },
    });

    const recipients = await this.resolveAudience(input.actorAuthUserId);
    if (!recipients.length) {
      return { ok: true, id, recipients: 0 };
    }

    const raw = JSON.stringify(item);
    const multi = this.redis.multi();
    for (const recipientAuthUserId of recipients.slice(0, 5000)) {
      const inboxKey = inboxKeyFor(recipientAuthUserId);
      multi.zadd(inboxKey, String(createdAtMs), raw);
      multi.zremrangebyrank(inboxKey, 0, -1001);
    }
    await multi.exec();

    return { ok: true, id, recipients: recipients.length };
  }

  async listMyFeed(context: MeuredContext, params: { take: number; before?: number }) {
    const key = inboxKeyFor(context.authUserId);
    const max = typeof params.before === 'number' ? `(${params.before}` : '+inf';
    const rows = await this.redis.zrevrangebyscore(key, max, '-inf', 'LIMIT', 0, params.take);
    const items = rows
      .map((raw) => {
        try {
          return JSON.parse(raw) as FeedItem;
        } catch {
          return null;
        }
      })
      .filter((x): x is FeedItem => Boolean(x));
    const nextBefore = items.length ? items[items.length - 1]!.createdAtMs : null;
    return { items, nextBefore };
  }

  private async resolveAudience(actorAuthUserId: string): Promise<string[]> {
    const baseUrl = process.env.GRAPH_BASE_URL ?? 'http://meured-graph-service:3033';
    const apiKey = process.env.INTERNAL_GRAPH_API_KEY ?? '';
    if (!apiKey) {
      return [actorAuthUserId];
    }
    const url = `${baseUrl.replace(/\/$/, '')}/meuredgraphms/internal/audience/${encodeURIComponent(actorAuthUserId)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'x-internal-api-key': apiKey },
    });
    if (!response.ok) {
      return [actorAuthUserId];
    }
    const data = (await response.json().catch(() => null)) as null | { recipients?: unknown };
    const recipients = Array.isArray(data?.recipients)
      ? (data!.recipients as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    const all = new Set<string>([actorAuthUserId]);
    for (const id of recipients) all.add(id);
    return Array.from(all);
  }
}

function inboxKeyFor(authUserId: string) {
  return `meured:feed:inbox:${authUserId}`;
}
