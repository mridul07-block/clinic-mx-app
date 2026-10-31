import { DurableObject } from 'cloudflare:workers';
import type { Env, Signal } from './index';

/**
 * The one place every staff screen's socket is held (FND-09). Hibernation keeps idle sockets open
 * without the object running; a "ping" is answered "pong" without waking it. Each socket remembers
 * the centres its token named. A signal reaches only the sockets of the centres it names (every
 * socket for a change everywhere), and tells each only its own centres. Nothing is stored and
 * nothing is logged.
 */
interface Attachment {
  centres: string[];
}

export class LiveHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/connect') {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({
        centres: url.searchParams.getAll('centre'),
      } satisfies Attachment);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname === '/signal') {
      const signal = await request.json<Signal>();
      let sent = 0;
      for (const socket of this.ctx.getWebSockets()) {
        const theirs = (socket.deserializeAttachment() as Attachment | null)?.centres ?? [];
        const changed = signal.all
          ? theirs
          : theirs.filter((centre) => signal.centres.includes(centre));
        if (changed.length === 0) continue;
        try {
          socket.send(JSON.stringify({ centres: changed }));
          sent += 1;
        } catch {
          // A socket closing as the signal goes; its screen reconnects and checks anyway.
        }
      }
      return Response.json({ sent });
    }
    return new Response('Not found', { status: 404 });
  }

  /** Screens only ping, which is answered without waking the hub; anything else is ignored. */
  override webSocketMessage(): void {}

  override webSocketClose(socket: WebSocket, code: number): void {
    try {
      socket.close(code === 1005 ? 1000 : code, 'Closed');
    } catch {
      // Already closed.
    }
  }
}
