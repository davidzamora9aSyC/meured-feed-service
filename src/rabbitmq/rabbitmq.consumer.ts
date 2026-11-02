import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel, Connection, ConsumeMessage, connect } from 'amqplib';
import { FeedService } from '../feed/feed.service';

const queueAssertOptions = (queue: string) => ({
  durable: true,
  arguments: {
    'x-dead-letter-exchange': 'deadletter',
    'x-dead-letter-routing-key': `${queue}.dlq`,
  },
});

const amqpErrorCode = (error: unknown) =>
  error && typeof error === 'object' && 'code' in error
    ? (error as { code?: number }).code
    : undefined;

@Injectable()
export class RabbitConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitConsumer.name);
  private connection: Connection | null = null;
  private channel: Channel | null = null;
  private rabbitUrl: string | null = null;
  private exchange = 'meured.events';
  private queue = 'meured.q.feed';
  private isShuttingDown = false;
  private isConnecting = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly reconnectDelayMs = 5000;

  constructor(
    private readonly config: ConfigService,
    private readonly feed: FeedService,
  ) {}

  async onModuleInit() {
    this.rabbitUrl = this.config.get<string>('RABBITMQ_URL') ?? null;
    if (!this.rabbitUrl) {
      this.logger.warn('RABBITMQ_URL no configurado, consumer deshabilitado');
      return;
    }

    this.exchange = this.config.get<string>('RABBITMQ_EXCHANGE_MEURED') ?? 'meured.events';
    this.queue = this.config.get<string>('RABBITMQ_QUEUE_FEED') ?? 'meured.q.feed';
    await this.connectWithRetry();
  }

  async onModuleDestroy() {
    this.isShuttingDown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this.cleanupConnection();
  }

  private async connectWithRetry() {
    if (!this.rabbitUrl || this.isShuttingDown || this.isConnecting) return;

    this.isConnecting = true;
    try {
      await this.cleanupConnection();
      this.connection = await connect(this.rabbitUrl);
      this.channel = await this.connection.createChannel();
      const channel = this.channel;
      await channel.assertExchange(this.exchange, 'topic', { durable: true });
      await this.assertQueueForConsume(this.queue);
      await channel.bindQueue(this.queue, this.exchange, 'meured.#');
      await this.channel.prefetch(20);
      await channel.consume(this.queue, (msg) => this.handleMessage(msg, channel), { noAck: false });

      this.connection.on('close', () => {
        if (this.isShuttingDown) return;
        this.logger.warn('Conexion RabbitMQ cerrada, reintentando...');
        this.scheduleReconnect();
      });
      this.connection.on('error', (error) => {
        if (this.isShuttingDown) return;
        this.logger.error('Error de conexion RabbitMQ', error as Error);
      });
      channel.on('close', () => {
        if (this.isShuttingDown) return;
        this.logger.warn('Canal RabbitMQ cerrado, reintentando...');
        this.channel = null;
        this.scheduleReconnect();
      });
      channel.on('error', (error) => {
        if (this.isShuttingDown) return;
        this.logger.error('Error de canal RabbitMQ', error as Error);
      });

      this.logger.log(`Escuchando ${this.queue} (exchange=${this.exchange})`);
    } catch (error) {
      this.logger.error('No se pudo conectar a RabbitMQ', error as Error);
      this.scheduleReconnect();
    } finally {
      this.isConnecting = false;
    }
  }

  private async assertQueueForConsume(queue: string) {
    if (!this.connection || !this.channel) return;

    const checkChannel = await this.connection.createChannel();
    try {
      await checkChannel.checkQueue(queue);
      return;
    } catch (error) {
      if (amqpErrorCode(error) !== 404) throw error;
    } finally {
      await checkChannel.close().catch(() => undefined);
    }

    await this.channel.assertQueue(queue, queueAssertOptions(queue));
  }

  private scheduleReconnect() {
    if (this.isShuttingDown || this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectWithRetry();
    }, this.reconnectDelayMs);
  }

  private async cleanupConnection() {
    this.channel?.removeAllListeners();
    this.connection?.removeAllListeners();
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
    this.channel = null;
    this.connection = null;
  }

  private async handleMessage(msg: ConsumeMessage | null, channel: Channel) {
    if (!msg) return;
    try {
      const payload = JSON.parse(msg.content.toString()) as {
        actorAuthUserId?: string;
        objectType?: string;
        objectId?: string;
        payload?: unknown;
        occurredAt?: string;
      };

      const type = msg.fields.routingKey;
      const actorAuthUserId = String(payload.actorAuthUserId ?? '');
      const objectType = String(payload.objectType ?? '');
      const objectId = String(payload.objectId ?? '');
      if (actorAuthUserId && objectType && objectId) {
        await this.feed.ingestFromEvent({
          type,
          actorAuthUserId,
          objectType,
          objectId,
          payload: payload.payload ?? undefined,
          occurredAt: payload.occurredAt ?? undefined,
        });
      }

      channel.ack(msg);
    } catch (error) {
      this.logger.error('Error procesando evento', error as Error);
      channel.ack(msg);
    }
  }
}
