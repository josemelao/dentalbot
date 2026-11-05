import { Channel } from '../contracts/channel';

export interface OutboundMessage {
  externalUserId: string;
  text: string;
}

export interface ChannelAdapter {
  readonly channel: Channel;
  send(message: OutboundMessage): Promise<{ externalMessageId: string }>;
}
