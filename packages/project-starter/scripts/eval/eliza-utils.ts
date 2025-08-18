import { io, type Socket } from 'socket.io-client'; // CLIENT, not Server!
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';
import { SOCKET_MESSAGE_TYPE } from './types.js';

export class ElizaSocketManager {
  private readonly entityId = uuidv4();
  private readonly agentId: string;
  private readonly serverId = '00000000-0000-0000-0000-000000000000';
  private readonly apiBase: string;
  private socket: Socket | null = null; // Socket (client), not Server!
  private isConnected = false;
  private pendingResponses = 0;
  private activeChannels = new Set<string>();
  private totalResponsesReceived = 0;

  constructor(baseUrl: string, agentId: string) {
    this.apiBase = baseUrl.replace(/\/+$/, '');
    this.agentId = agentId;
  }

  async openSocket(): Promise<void> {
    console.log(`🔌 Attempting to connect to: ${this.apiBase}`);

    // Connect as a CLIENT to the existing server
    this.socket = io(this.apiBase, {
      path: '/socket.io/',
      autoConnect: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 20000,
      transports: ['websocket'], // Force polling for now
      forceNew: true,
      upgrade: false, // Don't try to upgrade to websocket yet
      withCredentials: true,
    });

    await new Promise<void>((resolve, reject) => {
      if (!this.socket) return reject('socket init err');

      this.socket.once('connect', () => {
        console.log('✅ Connected to server successfully!');
        this.isConnected = true;
        this.installListeners();
        resolve();
      });

      this.socket.once('connect_error', (error) => {
        console.error('❌ Connection failed:', error.message);
        reject(error);
      });
    });
  }

  private async createDMChannel(channelId: string): Promise<string> {
    const res = await fetch(`${this.apiBase}/api/messaging/central-channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: channelId,
        name: `Eval ${new Date().toISOString()}`,
        server_id: this.serverId,
        participantCentralUserIds: [this.entityId, this.agentId],
        type: 'DM',
        metadata: {
          isDm: true,
          user1: this.entityId,
          user2: this.agentId,
          forAgent: this.agentId,
          createdAt: new Date().toISOString(),
        },
      }),
    });

    if (!res.ok) throw new Error(`Channel creation failed: ${await res.text()}`);
    return (await res.json()).data.id;
  }

  private async ensureAgentInChannel(channelId: string): Promise<boolean> {
    try {
      const r = await fetch(`${this.apiBase}/api/messaging/central-channels/${channelId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: this.agentId }),
      });

      if (r.ok) return true;
      const txt = await r.text();
      return r.status === 409 || txt.toLowerCase().includes('already');
    } catch {
      return false;
    }
  }

  private async joinChannel(channelId: string): Promise<void> {
    if (!this.socket || !this.isConnected) throw Error('socket not ready');
    this.socket.emit('message', {
      type: SOCKET_MESSAGE_TYPE.ROOM_JOINING,
      payload: {
        channelId: channelId,
        entityId: this.entityId,
        serverId: this.serverId,
        metadata: { isDm: true, sessionType: 'evaluation' },
      },
    });
    await new Promise((r) => setTimeout(r, 400));
  }

  async createAndSetupChannel(): Promise<string> {
    const channelId = uuidv4();
    const actualChannelId = await this.createDMChannel(channelId);

    let retries = 4;
    while (!(await this.ensureAgentInChannel(actualChannelId)) && retries--) {
      await new Promise((r) => setTimeout(r, 400));
    }

    await this.joinChannel(actualChannelId);
    this.activeChannels.add(actualChannelId);
    return actualChannelId;
  }

  async send(text: string, channelId: string): Promise<void> {
    if (!this.socket || !this.isConnected) throw Error('socket not ready');
    this.pendingResponses++;
    console.log(
      `[${new Date().toISOString()}] Sending: "${text}" to channel ${channelId} (pending: ${this.pendingResponses})`
    );

    this.socket.emit('message', {
      type: SOCKET_MESSAGE_TYPE.SEND_MESSAGE,
      payload: {
        senderId: this.entityId,
        senderName: 'Evaluator',
        message: text,
        channelId: channelId,
        serverId: this.serverId,
        messageId: uuidv4(),
        source: 'client_chat',
        attachments: [],
        metadata: { channelType: 'DM' },
      },
    });
  }

  private installListeners(): void {
    if (!this.socket) return;

    this.socket.on('messageBroadcast', (d) => {
      const target = d.channelId ?? d.roomId;
      if (!this.activeChannels.has(target) || d.senderId === this.entityId) return;

      const text = d.text ?? d.content ?? '';
      this.pendingResponses--;
      this.totalResponsesReceived++;
      console.log(
        `[${new Date().toISOString()}] Received response: "${text.substring(0, 100)}..." from ${target} (pending: ${this.pendingResponses})`
      );
    });
  }

  async waitForResponses(): Promise<void> {
    const maxWaitMs = 3 * 60 * 1000; // 3 minutes
    const pollInterval = 100;
    const start = Date.now();
    while (this.pendingResponses > 0) {
      if (Date.now() - start > maxWaitMs) {
        console.error(
          `[${new Date().toISOString()}] Error: Timed out waiting for responses after 3 minutes (pending: ${this.pendingResponses})`
        );
        break;
      }
      await new Promise((r) => setTimeout(r, pollInterval));
    }
  }

  getActiveChannels(): Set<string> {
    return this.activeChannels;
  }

  getTotalResponsesReceived(): number {
    return this.totalResponsesReceived;
  }
}
