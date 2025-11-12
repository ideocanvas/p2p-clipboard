
// Connection strategies configuration
export type ConnectionStrategy = "webrtc-peerjs" | "webrtc-custom" | "server-relay";

export interface STUNTURNConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

// Free public STUN/TURN servers - optimized for reliability
export const ICE_SERVERS: RTCIceServer[] = [
  // Primary STUN servers (Google's reliable servers)
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" },

  // Backup STUN servers
  { urls: "stun:stun.voipbuster.com:3478" },
  { urls: "stun:stun.voipstunt.com:3478" },
  { urls: "stun:stun.ideasip.com" },
  { urls: "stun:stun.sipgate.net:3478" },

  // More reliable TURN servers
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turn:openrelay.metered.ca:443?transport=tcp"
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: [
      "turn:relay.metered.ca:80",
      "turn:relay.metered.ca:443",
      "turn:relay.metered.ca:443?transport=tcp"
    ],
    username: "free",
    credential: "free",
  },
  {
    urls: "turn:turn.anyfirewall.com:443?transport=tcp",
    username: "webrtc",
    credential: "webrtc",
  },
];

export const STRATEGY_CONFIG = {
  "webrtc-peerjs": {
    name: "WebRTC (PeerJS)",
    timeout: 15000, // 15 seconds
    description: "Using PeerJS cloud signaling with STUN/TURN",
  },
  "webrtc-custom": {
    name: "WebRTC (Custom)",
    timeout: 15000,
    description: "Direct WebRTC with server signaling",
  },
  "server-relay": {
    name: "Server Relay",
    timeout: 10000,
    description: "File transfer through server",
  },
};
