declare module "osc" {
  export interface OscArgument {
    type: "i" | "f" | "s" | string;
    value: string | number;
  }

  export interface OscMessage {
    address: string;
    args: OscArgument[];
  }

  export interface UDPPortOptions {
    localAddress?: string;
    localPort?: number;
    remoteAddress?: string;
    remotePort?: number;
    metadata?: boolean;
  }

  export class UDPPort {
    constructor(options: UDPPortOptions);
    open(): void;
    close(): void;
    send(message: { address: string; args: OscArgument[] }): void;
    on(event: "ready", listener: () => void): void;
    on(event: "message", listener: (message: OscMessage) => void): void;
    on(event: "error", listener: (error: Error) => void): void;
  }
}
