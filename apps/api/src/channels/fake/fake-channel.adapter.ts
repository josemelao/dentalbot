import { ChannelAdapter, OutboundMessage } from '../channel-adapter';

export class FakeChannelAdapter implements ChannelAdapter {
  readonly channel = 'telegram' as const;
  readonly sent: OutboundMessage[] = [];

  async send(message: OutboundMessage): Promise<{ externalMessageId: string }> {
    this.sent.push(message);
    return { externalMessageId: `fake-${this.sent.length}` };
  }
}
