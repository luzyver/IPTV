export interface Channel {
  id: string;
  name: string;
  logo?: string;
  group: string;
  userAgent?: string;
  referer?: string;
  url: string;
}

export interface PlayerStats {
  resolution: string;
  latency: string;
  bufferLength: number;
  bandwidth: string;
}
