export enum ServerEnvironment {
  Development = 'development',
  Staging = 'staging',
  Production = 'production',
  Custom = 'custom'
}

export enum ConnectionStatus {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Error = 'error'
}

export interface ServerConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  password?: string;
  database?: number;
  environment: ServerEnvironment;
  ssl?: boolean;
  sslOptions?: {
    ca?: string;
    cert?: string;
    key?: string;
    rejectUnauthorized?: boolean;
  };
  tags?: string[];
  favorite?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}