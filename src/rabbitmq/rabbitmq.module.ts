import { Module } from '@nestjs/common';
import { RabbitConsumer } from './rabbitmq.consumer';
import { FeedModule } from '../feed/feed.module';

@Module({
  imports: [FeedModule],
  providers: [RabbitConsumer],
})
export class RabbitmqModule {}
