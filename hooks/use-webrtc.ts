"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Peer, { DataConnection } from "peerjs";
import { ConnectionStrategy, ICE_SERVERS } from "@/lib/connection-strategies";
import { LogEntry } from "@/components/connection-logger";

export type ConnectionState =
  | "waiting"
  | "connecting"
  | "verifying"
  | "connected"
  | "transferring"
  | "disconnected";

export interface FileTransfer {
  id: string;
  name: string;
  size: number;
  type: string;
  progress: number;
  status: "pending" | "transferring" | "completed" | "error";
  error?: string;
}

interface UseWebRTCProps {
  role: "sender" | "receiver";
  sessionId: string;
  onFileReceived?: (file: Blob, metadata: { name: string; type: string }) => void;
  onLog?: (log: LogEntry) => void;
}

const CHUNK_SIZE = 16384; // 16KB chunks
const SESSION_TIMEOUT = 15 * 60 * 1000; // 15 minutes

export function useWebRTC({ role, sessionId, onFileReceived, onLog }: UseWebRTCProps) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("waiting");
  const [files, setFiles] = useState<FileTransfer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [currentStrategy, setCurrentStrategy] = useState<ConnectionStrategy | null>(null);
  const [verificationCode, setVerificationCode] = useState<string | null>(null);
  const [isVerified, setIsVerified] = useState(false);
  const verificationCodeRef = useRef<string | null>(null);
  const verificationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentStrategyRef = useRef<ConnectionStrategy | null>(null);
  const isVerifiedRef = useRef(false);

  const peerRef = useRef<Peer | null>(null);
  const connectionRef = useRef<DataConnection | null>(null);
  const rtcConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileBuffersRef = useRef<Map<string, { chunks: Uint8Array[]; metadata: { name: string; size: number; type: string; totalChunks: number } }>>(
    new Map()
  );
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const candidateCountRef = useRef(0);
  const strategyAttemptRef = useRef(0);

  const log = useCallback(
    (level: LogEntry["level"], message: string, details?: string) => {
      const entry: LogEntry = {
        timestamp: new Date(),
        level,
        message,
        details,
      };
      onLog?.(entry);
      console.log(`[${level.toUpperCase()}] ${message}`, details || "");
    },
    [onLog]
  );

  // Session timeout handler
  const resetTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      if (connectionState !== "transferring") {
        log("warning", "Session timed out after 15 minutes");
        setError("Session timed out");
        setConnectionState("disconnected");
        cleanup();
      }
    }, SESSION_TIMEOUT);
  }, [connectionState, log]);

  const cleanup = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    if (verificationTimeoutRef.current) clearTimeout(verificationTimeoutRef.current);

    // Cleanup data channel without triggering events
    if (dataChannelRef.current) {
      dataChannelRef.current.onclose = null;
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }

    // Cleanup RTC connection
    if (rtcConnectionRef.current) {
      rtcConnectionRef.current.close();
      rtcConnectionRef.current = null;
    }

    // Cleanup PeerJS connection
    if (connectionRef.current) {
      connectionRef.current.close();
      connectionRef.current = null;
    }

    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
  }, []);

  // Generate 6-digit verification code
  const generateVerificationCode = useCallback(() => {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    return code;
  }, []);

  // Verify code entered by receiver
  const verifyCode = useCallback((enteredCode: string) => {
    if (!verificationCode) {
      log("error", "No verification code available");
      setError("No verification code available - please wait for connection");
      return false;
    }

    if (enteredCode === verificationCode) {
      setIsVerified(true);
      setConnectionState("connected");
      log("success", "Verification successful");

      // Send verification success message
      const message = { type: "verification-success" };
      if (currentStrategy === "webrtc-peerjs" && connectionRef.current) {
        connectionRef.current.send(message);
      } else if (currentStrategy === "webrtc-custom" && dataChannelRef.current) {
        dataChannelRef.current.send(JSON.stringify(message));
      }
      return true;
    } else {
      log("error", "Verification failed - incorrect code", `Expected: ${verificationCode}, Got: ${enteredCode}`);
      setError("Incorrect verification code - please check and try again");
      return false;
    }
  }, [verificationCode, currentStrategy, log]);

  // Strategy 1: PeerJS with STUN/TURN
  const tryPeerJSStrategy = useCallback(async () => {
    return new Promise<boolean>((resolve) => {
      try {
        setCurrentStrategy("webrtc-peerjs");
        currentStrategyRef.current = "webrtc-peerjs";
        log("info", "Strategy 1: PeerJS with STUN/TURN", "Trying PeerJS signaling");

        const peerId = role === "receiver" ? sessionId : `${sessionId}-sender`;

        // Try different peer server configurations with fallback
        const peerConfigs = [
          {
            host: '0.peerjs.com',
            port: 443,
            secure: true,
            path: '/',
            timeout: 10000
          },
          {
            host: '1.peerjs.com',
            port: 443,
            secure: true,
            path: '/',
            timeout: 10000
          },
          {
            host: '2.peerjs.com',
            port: 443,
            secure: true,
            path: '/',
            timeout: 10000
          },
          {
            host: '3.peerjs.com',
            port: 443,
            secure: true,
            path: '/',
            timeout: 10000
          },
          {
            host: 'peerjs-server.herokuapp.com',
            port: 443,
            secure: true,
            path: '/myapp',
            timeout: 10000
          }
        ];

        let currentConfigIndex = 0;
        let peer: Peer | null = null;
        let connectionTimeout: NodeJS.Timeout | null = null;

        const tryNextConfig = () => {
          if (currentConfigIndex >= peerConfigs.length) {
            log("warning", "All PeerJS servers failed", "Trying next strategy");
            resolve(false);
            return;
          }

          const config = peerConfigs[currentConfigIndex];
          log("info", `Trying PeerJS server: ${config.host}`);

          // Clean up previous peer instance
          if (peer) {
            peer.destroy();
          }

          peer = new Peer(peerId, {
            debug: 1, // Minimal debug level
            config: { iceServers: ICE_SERVERS },
            ...config
          });

          peerRef.current = peer;

          // Set timeout for this specific configuration
          if (connectionTimeout) clearTimeout(connectionTimeout);
          connectionTimeout = setTimeout(() => {
            log("warning", `PeerJS server ${config.host} timed out after ${config.timeout}ms`);
            currentConfigIndex++;
            tryNextConfig();
          }, config.timeout);

          peer.on("open", (id) => {
            log("success", `PeerJS peer open on ${config.host}: ${id}`);
            if (connectionTimeout) clearTimeout(connectionTimeout);
            resetTimeout();

            // If sender, wait a bit for receiver to be ready, then connect
            if (role === "sender") {
              setTimeout(() => {
                log("info", "Attempting to connect to receiver...");
                const conn = peer!.connect(sessionId, {
                  reliable: true,
                  serialization: 'json'
                });

                const connectTimeout = setTimeout(() => {
                  log("warning", "Connection attempt timed out");
                  conn.close();
                  currentConfigIndex++;
                  tryNextConfig();
                }, 8000);

                conn.on("open", () => {
                  log("success", "Data connection established");
                  clearTimeout(connectTimeout);
                  setupPeerJSConnection(conn);
                  resolve(true);
                });

                conn.on("error", (err) => {
                  log("error", "Connection error", String(err));
                  clearTimeout(connectTimeout);
                  currentConfigIndex++;
                  tryNextConfig();
                });
              }, 1000); // Reduced wait time
            }
          });

          peer.on("error", (err) => {
            log("error", `PeerJS error on ${config.host}: ${err.type}`, String(err));
            if (connectionTimeout) clearTimeout(connectionTimeout);

            // Handle specific peerjs errors
            if (err.type === 'unavailable-id' || err.type === 'server-error' || err.type === 'socket-error') {
              currentConfigIndex++;
              tryNextConfig();
            } else {
              // For network errors, try next config
              currentConfigIndex++;
              tryNextConfig();
            }
          });

          if (role === "receiver") {
            peer.on("connection", (conn) => {
              log("success", "Sender connected via PeerJS");
              if (connectionTimeout) clearTimeout(connectionTimeout);
              setupPeerJSConnection(conn);
              resolve(true);
            });
          }
        };

        // Start with first configuration
        tryNextConfig();
      } catch (err) {
        log("error", "PeerJS failed", String(err));
        resolve(false);
      }
    });
  }, [role, sessionId, log, resetTimeout]);

  const setupPeerJSConnection = (conn: DataConnection) => {
    connectionRef.current = conn;

    // Check if connection is already open
    if (conn.open) {
      handlePeerJSConnectionOpen(conn);
    } else {
      conn.on("open", () => {
        handlePeerJSConnectionOpen(conn);
      });
    }

    conn.on("data", (data: unknown) => {
      resetTimeout();
      handleIncomingData(data);
    });

    conn.on("close", () => {
      log("info", "Connection closed");
      setConnectionState("disconnected");
    });

    conn.on("error", (err) => {
      log("error", "Connection error", String(err));
    });
  };

  const handlePeerJSConnectionOpen = (conn: DataConnection) => {
    log("success", "Data channel open");

    if (role === "sender") {
      // Generate and send verification code
      const code = generateVerificationCode();
      setVerificationCode(code);
      verificationCodeRef.current = code;
      setConnectionState("verifying");
      log("info", "Verification code generated", `Code: ${code}`);

      conn.send({
        type: "verification-request",
        verificationCode: code
      });
    } else {
      // Receiver waits for verification request
      setConnectionState("verifying");
      log("info", "Waiting for verification code");
    }

    setError(null);
    resetTimeout();
  };

  // Strategy 2: Custom WebRTC with server signaling
  const tryCustomWebRTCStrategy = useCallback(async () => {
    return new Promise<boolean>((resolve) => {
      let resolved = false;

      try {
        setCurrentStrategy("webrtc-custom");
        currentStrategyRef.current = "webrtc-custom";
        log("info", "Strategy 2: Custom WebRTC", "Using server signaling");

        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        rtcConnectionRef.current = pc;

        const timeout = setTimeout(() => {
          if (!resolved) {
            log("warning", "Custom WebRTC timed out after 30s", "Trying server relay");
            pc.close();
            resolved = true;
            resolve(false);
          }
        }, 30000); // Increased to 30s

        pc.onicecandidate = async (event) => {
          if (event.candidate) {
            try {
              await fetch("/api/signal", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  sessionId,
                  type: "ice-candidate",
                  data: event.candidate.toJSON(),
                  role,
                }),
              });
            } catch (err) {
              log("error", "Failed to send ICE candidate", String(err));
            }
          }
        };

        pc.onconnectionstatechange = () => {
          log("info", `WebRTC connection state: ${pc.connectionState}`);
          if (pc.connectionState === "failed" || pc.connectionState === "closed") {
            if (!resolved) {
              clearTimeout(timeout);
              resolved = true;
              resolve(false);
            }
          }
          // Don't set to connected here - wait for data channel to open
        };

        if (role === "sender") {
          const dataChannel = pc.createDataChannel("fileTransfer", { ordered: true });
          dataChannelRef.current = dataChannel;
          setupDataChannel(dataChannel, () => {
            if (!resolved) {
              clearTimeout(timeout);
              resolved = true;
              setError(null);
              resolve(true);
            }
          });

          pc.createOffer()
            .then((offer) => pc.setLocalDescription(offer))
            .then(() => {
              log("info", "Created and sent offer");
              return fetch("/api/signal", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  sessionId,
                  type: "offer",
                  data: pc.localDescription,
                }),
              });
            })
            .then(() => startPollingForAnswer(pc))
            .catch((err) => {
              log("error", "Offer failed", String(err));
              if (!resolved) {
                clearTimeout(timeout);
                resolved = true;
                resolve(false);
              }
            });
        } else {
          pc.ondatachannel = (event) => {
            log("info", "Data channel received");
            dataChannelRef.current = event.channel;
            setupDataChannel(event.channel, () => {
              if (!resolved) {
                clearTimeout(timeout);
                resolved = true;
                setError(null);
                resolve(true);
              }
            });
          };

          startPollingForOffer(pc).then((success) => {
            if (!success && !resolved) {
              clearTimeout(timeout);
              resolved = true;
              resolve(false);
            }
          });
        }
      } catch (err) {
        log("error", "Custom WebRTC failed", String(err));
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      }
    });
  }, [role, sessionId, log]);

  const setupDataChannel = (channel: RTCDataChannel, onSuccess: () => void) => {
    channel.onopen = () => {
      log("success", "Data channel open - connection established");

      if (role === "sender") {
        // Generate and send verification code
        const code = generateVerificationCode();
        setVerificationCode(code);
        verificationCodeRef.current = code;
        setConnectionState("verifying");
        log("info", "Verification code generated", `Code: ${code}`);

        channel.send(JSON.stringify({
          type: "verification-request",
          verificationCode: code
        }));
      } else {
        // Receiver waits for verification request
        setConnectionState("verifying");
        log("info", "Waiting for verification code");
      }

      resetTimeout();
      onSuccess();
    };

    channel.onmessage = (event) => {
      resetTimeout();
      const data = JSON.parse(event.data);
      handleIncomingData(data);
    };

    channel.onclose = () => {
      // Only log if this is the active strategy
      if (currentStrategy === "webrtc-custom") {
        log("info", "Data channel closed");
        setConnectionState("disconnected");
      }
    };
  };

  const startPollingForAnswer = async (pc: RTCPeerConnection) => {
    pollingIntervalRef.current = setInterval(async () => {
      try {
        const response = await fetch(
          `/api/signal?sessionId=${sessionId}&role=sender&lastCount=${candidateCountRef.current}`
        );
        const data = await response.json();

        if (data.answer && !pc.remoteDescription) {
          log("success", "Received answer");
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        }

        if (data.iceCandidates) {
          for (const candidate of data.iceCandidates) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
          candidateCountRef.current = data.candidateCount || 0;
        }
      } catch (err) {
        // Silent
      }
    }, 1000);
  };

  const startPollingForOffer = async (pc: RTCPeerConnection): Promise<boolean> => {
    return new Promise((resolve) => {
      pollingIntervalRef.current = setInterval(async () => {
        try {
          const response = await fetch(
            `/api/signal?sessionId=${sessionId}&role=receiver&lastCount=${candidateCountRef.current}`
          );
          const data = await response.json();

          if (data.offer && !pc.remoteDescription) {
            log("success", "Received offer");
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            log("info", "Sent answer");
            await fetch("/api/signal", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId,
                type: "answer",
                data: pc.localDescription,
              }),
            });
            resolve(true);
          }

          if (data.iceCandidates) {
            for (const candidate of data.iceCandidates) {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            }
            candidateCountRef.current = data.candidateCount || 0;
          }
        } catch (err) {
          // Silent
        }
      }, 1000);
    });
  };

  // Server relay polling (for receiver)
  const startServerRelayPolling = () => {
    log("info", "Starting server relay polling");
    const processedFiles = new Set<string>();

    pollingIntervalRef.current = setInterval(async () => {
      try {
        // Check for new file metadata and verification status
        const response = await fetch(`/api/relay?sessionId=${sessionId}`);
        const data = await response.json();

        // For receiver: Check if verification code is available
        if (role === "receiver" && !verificationCode && data.verificationCode) {
          setVerificationCode(data.verificationCode);
          log("info", "Verification code received from server", `Code: ${data.verificationCode}`);
        }

        // For sender: Check if verification is confirmed
        if (role === "sender" && !isVerified && data.verificationConfirmed) {
          setIsVerified(true);
          setConnectionState("connected");
          log("success", "Receiver has verified the connection");
        }

        // Process ALL available files, not just the first one
        if (data.files && data.files.length > 0) {
          for (const fileInfo of data.files) {
            const { id, name, size, fileType, totalChunks, availableChunks } = fileInfo;

            // Skip if already processed or being processed
            if (processedFiles.has(id) || fileBuffersRef.current.has(id)) {
              continue;
            }

            // Wait for at least 10% of chunks or all chunks if file is small
            const minChunks = Math.min(Math.ceil(totalChunks * 0.1), totalChunks);

            if (availableChunks >= minChunks) {
              processedFiles.add(id);
              log("info", `Receiving: ${name}`, `${(size / 1024 / 1024).toFixed(2)} MB`);

              fileBuffersRef.current.set(id, {
                chunks: new Array(totalChunks),
                metadata: { name, size, type: fileType, totalChunks },
              });

              setFiles((prev) => [
                ...prev,
                { id, name, size, type: fileType, progress: 0, status: "transferring" },
              ]);

              setConnectionState("transferring");

              // Start downloading chunks with a small delay
              setTimeout(() => downloadChunksViaRelay(id, totalChunks), 100);
            }
          }
        }
      } catch (err) {
        // Silent polling errors
      }
    }, 500); // Poll more frequently for better responsiveness
  };

  const downloadChunksViaRelay = async (fileId: string, totalChunks: number) => {
    try {
      const maxRetries = 3;
      const missingChunks: number[] = [];

      // First pass: download all chunks
      for (let i = 0; i < totalChunks; i++) {
        // Add small delay between requests to avoid overwhelming server
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }

        let success = false;
        for (let retry = 0; retry < maxRetries && !success; retry++) {
          try {
            const response = await fetch(`/api/relay?sessionId=${sessionId}&fileId=${fileId}&chunkIndex=${i}`);
            const data = await response.json();

            if (data.data) {
              const fileBuffer = fileBuffersRef.current.get(fileId);
              if (fileBuffer) {
                // Convert base64 to Uint8Array
                const chunk = Uint8Array.from(atob(data.data), (c) => c.charCodeAt(0));
                fileBuffer.chunks[i] = chunk;
                success = true;

                const receivedChunks = fileBuffer.chunks.filter((c) => c !== undefined).length;
                const progress = (receivedChunks / totalChunks) * 100;

                setFiles((prev) =>
                  prev.map((f) =>
                    f.id === fileId
                      ? { ...f, progress, status: progress === 100 ? "completed" : "transferring" }
                      : f
                  )
                );

                resetTimeout();
              }
            } else {
              // Chunk not available yet, wait and retry
              await new Promise((resolve) => setTimeout(resolve, 100 * (retry + 1)));
            }
          } catch (err) {
            if (retry === maxRetries - 1) {
              missingChunks.push(i);
            } else {
              await new Promise((resolve) => setTimeout(resolve, 100 * (retry + 1)));
            }
          }
        }
      }

      // Check completion
      const fileBuffer = fileBuffersRef.current.get(fileId);
      if (fileBuffer) {
        const receivedChunks = fileBuffer.chunks.filter((c) => c !== undefined).length;

        if (receivedChunks === totalChunks) {
          const completeFile = new Blob(fileBuffer.chunks, {
            type: fileBuffer.metadata.type,
          });
          onFileReceived?.(completeFile, {
            name: fileBuffer.metadata.name,
            type: fileBuffer.metadata.type,
          });
          log("success", `Received: ${fileBuffer.metadata.name}`);

          setFiles((prev) => {
            const allComplete = prev.every((f) => f.status === "completed");
            if (allComplete) {
              setConnectionState("connected");
            }
            return prev;
          });
        } else if (missingChunks.length > 0) {
          log("error", `Failed to download ${missingChunks.length} chunks`);
          setFiles((prev) =>
            prev.map((f) =>
              f.id === fileId ? { ...f, status: "error" } : f
            )
          );
        }
      }
    } catch (err) {
      log("error", "Chunk download failed", String(err));
      setFiles((prev) =>
        prev.map((f) =>
          f.id === fileId ? { ...f, status: "error" } : f
        )
      );
    }
  };

  // Strategy 3: Server relay
  const tryServerRelayStrategy = useCallback(async () => {
    return new Promise<boolean>((resolve) => {
      try {
        setCurrentStrategy("server-relay");
        currentStrategyRef.current = "server-relay";
        log("info", "Strategy 3: Server relay", "Using server for file transfer");

        if (role === "sender") {
          // Generate verification code for sender
          const code = generateVerificationCode();
          setVerificationCode(code);
          verificationCodeRef.current = code;
          setConnectionState("verifying");
          log("info", "Verification code generated for server relay", `Code: ${code}`);

          // Store verification code in server for receiver to verify
          fetch("/api/relay", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId,
              type: "verification",
              verificationCode: code,
            }),
          }).catch(err => log("error", "Failed to store verification code", String(err)));

          // Start polling for verification confirmation
          startServerRelayPolling();

          setError(null);
          resetTimeout();
        } else {
          // Receiver waits for verification
          setConnectionState("verifying");
          log("info", "Waiting for verification via server relay");

          // Start polling for verification code and files
          startServerRelayPolling();
        }

        resolve(true);
      } catch (err) {
        log("error", "Server relay failed", String(err));
        resolve(false);
      }
    });
  }, [log, resetTimeout, role, generateVerificationCode, sessionId]);

  // Try strategies
  useEffect(() => {
    if (!sessionId || strategyAttemptRef.current > 0) return;

    strategyAttemptRef.current = 1;
    setConnectionState("connecting");

    const tryStrategies = async () => {
      log("info", "Multi-strategy connection starting");

      const peerJSSuccess = await tryPeerJSStrategy();
      if (peerJSSuccess) {
        log("success", "✓ PeerJS strategy successful");
        return;
      }

      // Cleanup failed PeerJS attempt
      if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
      }

      log("info", "Trying custom WebRTC...");
      const customWebRTCSuccess = await tryCustomWebRTCStrategy();
      if (customWebRTCSuccess) {
        log("success", "✓ Custom WebRTC successful");
        return;
      }

      // Cleanup failed WebRTC attempt
      if (dataChannelRef.current) {
        dataChannelRef.current.onclose = null;
        dataChannelRef.current.close();
        dataChannelRef.current = null;
      }
      if (rtcConnectionRef.current) {
        rtcConnectionRef.current.close();
        rtcConnectionRef.current = null;
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }

      log("info", "Falling back to server relay...");
      const serverRelaySuccess = await tryServerRelayStrategy();
      if (serverRelaySuccess) {
        log("success", "✓ Server relay active");
        return;
      }

      log("error", "✗ All strategies failed");
      setError("Unable to connect");
      setConnectionState("disconnected");
    };

    tryStrategies();

    return cleanup;
  }, [sessionId, tryPeerJSStrategy, tryCustomWebRTCStrategy, tryServerRelayStrategy, log, cleanup]);

  const handleIncomingData = (data: unknown) => {
    if (typeof data !== 'object' || data === null) return;

    const dataObj = data as Record<string, unknown>;

    if (dataObj.type === "verification-request") {
      // Receiver receives verification code from sender
      if (role === "receiver") {
        setVerificationCode(dataObj.verificationCode as string);
        log("info", "Verification code received", `Waiting for user to confirm`);
      }
    } else if (dataObj.type === "verification-response") {
      // Sender receives verification response from receiver
      if (role === "sender") {
        const enteredCode = dataObj.verificationCode as string;
        log("info", "Received verification response", `Entered code: ${enteredCode}, Expected: ${verificationCodeRef.current}, Strategy: ${currentStrategy}`);
        if (enteredCode === verificationCodeRef.current) {
          setIsVerified(true);
          isVerifiedRef.current = true;
          setConnectionState("connected");
          log("success", "Receiver verified the connection", `Current strategy: ${currentStrategy}, Connection ref: ${!!connectionRef.current}, Data channel ref: ${!!dataChannelRef.current}`);

          // Send success confirmation
          const message = { type: "verification-success" };
          log("info", "Attempting to send verification success", `Strategy state: ${currentStrategy}, Strategy ref: ${currentStrategyRef.current}, Connection open: ${connectionRef.current?.open}`);

          if (currentStrategyRef.current === "webrtc-peerjs") {
            if (connectionRef.current && connectionRef.current.open) {
              try {
                connectionRef.current.send(message);
                log("success", "Sent verification success to receiver via PeerJS");
              } catch (err) {
                log("error", "Failed to send verification success via PeerJS", String(err));
              }
            } else {
              log("error", "Cannot send verification success - PeerJS connection not open", `Connection: ${connectionRef.current}, Open: ${connectionRef.current?.open}`);
            }
          } else if (currentStrategyRef.current === "webrtc-custom") {
            if (dataChannelRef.current && dataChannelRef.current.readyState === "open") {
              try {
                dataChannelRef.current.send(JSON.stringify(message));
                log("success", "Sent verification success to receiver via WebRTC");
              } catch (err) {
                log("error", "Failed to send verification success via WebRTC", String(err));
              }
            } else {
              log("error", "Cannot send verification success - WebRTC data channel not open", `Data channel: ${dataChannelRef.current}, Ready state: ${dataChannelRef.current?.readyState}`);
            }
          } else {
            log("error", "Cannot send verification success - no valid connection strategy", `Strategy: ${currentStrategy}`);
          }
        } else {
          log("error", "Receiver entered incorrect code", `Expected: ${verificationCodeRef.current}, Got: ${enteredCode}`);
          setError("Receiver verification failed - incorrect code");

          // Send verification failure message
          const message = { type: "verification-failed" };
          if (currentStrategy === "webrtc-peerjs") {
            if (connectionRef.current && connectionRef.current.open) {
              connectionRef.current.send(message);
              log("info", "Sent verification failure to receiver");
            } else {
              log("error", "Cannot send verification failure - connection not open", `Connection open: ${connectionRef.current?.open}`);
            }
          } else if (currentStrategy === "webrtc-custom" && dataChannelRef.current && dataChannelRef.current.readyState === "open") {
            dataChannelRef.current.send(JSON.stringify(message));
            log("info", "Sent verification failure to receiver via WebRTC");
          } else {
            log("error", "Cannot send verification failure - no valid connection", `Strategy: ${currentStrategy}`);
          }
        }
      }
    } else if (dataObj.type === "verification-success") {
      // Receiver gets confirmation from sender
      if (role === "receiver") {
        setIsVerified(true);
        isVerifiedRef.current = true;
        setConnectionState("connected");
        log("success", "Verification successful");
        // Clear any pending verification timeout
        if (verificationTimeoutRef.current) clearTimeout(verificationTimeoutRef.current);
      }
    } else if (dataObj.type === "verification-failed") {
      // Receiver gets failure notification from sender
      if (role === "receiver") {
        log("error", "Verification failed - incorrect code entered");
        setError("Verification failed - please check the code and try again");
        setConnectionState("verifying"); // Stay in verifying state to allow retry
      }
    } else if (dataObj.type === "file-metadata") {
      // Only receiver should process file metadata
      if (role !== "receiver") {
        return;
      }

      if (!isVerifiedRef.current) {
        log("error", "File transfer attempted before verification", `isVerified state: ${isVerified}, isVerified ref: ${isVerifiedRef.current}`);
        return;
      }

      const { id, name, size, fileType, totalChunks } = dataObj as {
        id: string;
        name: string;
        size: number;
        fileType: string;
        totalChunks: number;
      };
      fileBuffersRef.current.set(id, {
        chunks: new Array(totalChunks),
        metadata: { name, size, type: fileType, totalChunks },
      });

      setFiles((prev) => [
        ...prev,
        { id, name, size, type: fileType, progress: 0, status: "transferring" },
      ]);

      setConnectionState("transferring");
      log("info", `Receiving: ${name}`, `${(size / 1024 / 1024).toFixed(2)} MB`);
    } else if (dataObj.type === "file-chunk") {
      // Only receiver should process file chunks
      if (role !== "receiver") {
        return;
      }

      const { fileId, chunkIndex, chunk } = dataObj as {
        fileId: string;
        chunkIndex: number;
        chunk: number[];
      };
      const fileBuffer = fileBuffersRef.current.get(fileId);

      if (fileBuffer) {
        fileBuffer.chunks[chunkIndex] = new Uint8Array(chunk);

        const receivedChunks = fileBuffer.chunks.filter((c) => c !== undefined).length;
        const progress = (receivedChunks / fileBuffer.metadata.totalChunks) * 100;

        setFiles((prev) =>
          prev.map((f) =>
            f.id === fileId
              ? { ...f, progress, status: progress === 100 ? "completed" : "transferring" }
              : f
          )
        );

        if (receivedChunks === fileBuffer.metadata.totalChunks) {
          const completeFile = new Blob(fileBuffer.chunks, {
            type: fileBuffer.metadata.type,
          });
          onFileReceived?.(completeFile, {
            name: fileBuffer.metadata.name,
            type: fileBuffer.metadata.type,
          });
          log("success", `Received: ${fileBuffer.metadata.name}`);

          setFiles((prev) => {
            const allComplete = prev.every((f) => f.status === "completed");
            if (allComplete) {
              setConnectionState("connected");
            }
            return prev;
          });
        }
      }
    }
  };

  const sendFiles = async (filesToSend: File[]) => {
    if (connectionState !== "connected") {
      setError("No active connection. Please verify the connection first.");
      return;
    }

    if (!isVerified) {
      setError("Connection not verified yet");
      return;
    }

    try {
      setConnectionState("transferring");
      log("info", `Sending ${filesToSend.length} file(s)`);

      for (let fileIndex = 0; fileIndex < filesToSend.length; fileIndex++) {
        const file = filesToSend[fileIndex];
        const fileId = `${Date.now()}-${Math.random()}`;
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

        try {
          setFiles((prev) => [
            ...prev,
            {
              id: fileId,
              name: file.name,
              size: file.size,
              type: file.type,
              progress: 0,
              status: "transferring",
            },
          ]);

          log("info", `Sending: ${file.name} (${fileIndex + 1}/${filesToSend.length})`, `${(file.size / 1024 / 1024).toFixed(2)} MB`);

          const metadata = {
            type: "file-metadata",
            id: fileId,
            name: file.name,
            size: file.size,
            fileType: file.type,
            totalChunks,
          };

          if (currentStrategy === "webrtc-peerjs" && connectionRef.current) {
            connectionRef.current.send(metadata);
          } else if (currentStrategy === "webrtc-custom" && dataChannelRef.current) {
            dataChannelRef.current.send(JSON.stringify(metadata));
          } else if (currentStrategy === "server-relay") {
            const metadataResponse = await fetch("/api/relay", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId, type: "metadata", data: metadata }),
            });

            if (!metadataResponse.ok) {
              throw new Error(`Failed to send metadata for ${file.name}`);
            }
          }

          const arrayBuffer = await file.arrayBuffer();
          for (let i = 0; i < totalChunks; i++) {
            const chunk = arrayBuffer.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            const chunkData = {
              type: "file-chunk",
              fileId,
              chunkIndex: i,
              chunk,
            };

            if (currentStrategy === "webrtc-peerjs" && connectionRef.current) {
              connectionRef.current.send(chunkData);
            } else if (currentStrategy === "webrtc-custom" && dataChannelRef.current) {
              // For WebRTC data channel, send binary data directly
              const customChunkData = {
                type: "file-chunk",
                fileId,
                chunkIndex: i,
                chunk: Array.from(new Uint8Array(chunk))
              };
              dataChannelRef.current.send(JSON.stringify(customChunkData));
            } else if (currentStrategy === "server-relay") {
              // Add small delay between chunks for relay
              if (i > 0) {
                await new Promise((resolve) => setTimeout(resolve, 10));
              }

              const base64 = btoa(String.fromCharCode(...new Uint8Array(chunk)));
              const chunkResponse = await fetch("/api/relay", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  sessionId,
                  type: "chunk",
                  data: { fileId, index: i, data: base64 },
                }),
              });

              if (!chunkResponse.ok) {
                throw new Error(`Failed to send chunk ${i} for ${file.name}`);
              }
            }

            const progress = ((i + 1) / totalChunks) * 100;
            setFiles((prev) =>
              prev.map((f) =>
                f.id === fileId
                  ? {
                      ...f,
                      progress,
                      status: progress === 100 ? "completed" : "transferring",
                    }
                  : f
              )
            );

            resetTimeout();
          }

          log("success", `✓ Sent: ${file.name}`);

          // Small delay between files
          if (fileIndex < filesToSend.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        } catch (fileErr) {
          log("error", `Failed to send: ${file.name}`, String(fileErr));
          setFiles((prev) =>
            prev.map((f) =>
              f.id === fileId ? { ...f, status: "error", error: String(fileErr) } : f
            )
          );
          // Continue with next file instead of stopping
        }
      }

      setConnectionState("connected");
    } catch (err) {
      log("error", "Transfer failed", String(err));
      setError("Failed to send files");
      setFiles((prev) =>
        prev.map((f) => (f.status === "transferring" ? { ...f, status: "error" } : f))
      );
    }
  };

  // Function for receiver to submit verification code
  const submitVerificationCode = useCallback((enteredCode: string) => {
    if (role !== "receiver") {
      log("error", "Only receiver can submit verification code");
      return false;
    }

    if (!enteredCode || enteredCode.length !== 6) {
      log("error", "Invalid verification code format", "Code must be 6 digits");
      setError("Please enter a valid 6-digit code");
      return false;
    }

    // Send verification response to sender
    const message = {
      type: "verification-response",
      verificationCode: enteredCode
    };

    if (currentStrategy === "webrtc-peerjs" && connectionRef.current) {
      connectionRef.current.send(message);
      log("info", "Verification code submitted via PeerJS", "Waiting for confirmation");
      setError(null); // Clear any previous errors

      // Set timeout to auto-verify if no response received
      if (verificationTimeoutRef.current) clearTimeout(verificationTimeoutRef.current);
      verificationTimeoutRef.current = setTimeout(() => {
        if (!isVerified && connectionState === "verifying") {
          log("warning", "Auto-verifying connection after timeout");
          setIsVerified(true);
          setConnectionState("connected");
        }
      }, 5000); // 5 second timeout
    } else if (currentStrategy === "webrtc-custom" && dataChannelRef.current) {
      dataChannelRef.current.send(JSON.stringify(message));
      log("info", "Verification code submitted via WebRTC", "Waiting for confirmation");
      setError(null); // Clear any previous errors

      // Set timeout to auto-verify if no response received
      if (verificationTimeoutRef.current) clearTimeout(verificationTimeoutRef.current);
      verificationTimeoutRef.current = setTimeout(() => {
        if (!isVerified && connectionState === "verifying") {
          log("warning", "Auto-verifying connection after timeout");
          setIsVerified(true);
          setConnectionState("connected");
        }
      }, 5000); // 5 second timeout
    } else if (currentStrategy === "server-relay") {
      // For server relay, verify directly with stored code
      if (!verificationCode) {
        log("error", "No verification code available yet");
        setError("Verification code not received yet - please wait");
        return false;
      }

      if (enteredCode === verificationCodeRef.current) {
        setIsVerified(true);
        isVerifiedRef.current = true;
        setConnectionState("connected");
        log("success", "Verification successful");

        // Notify sender through the relay server
        fetch("/api/relay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            type: "verification-confirmed",
            verificationCode: enteredCode,
          }),
        }).catch(err => log("error", "Failed to confirm verification", String(err)));

        return true;
      } else {
        log("error", "Verification failed - incorrect code", `Expected: ${verificationCodeRef.current}, Got: ${enteredCode}`);
        setError("Incorrect verification code - please check and try again");
        return false;
      }
    }

    return true;
  }, [role, currentStrategy, log, verificationCode, sessionId]);

  return {
    connectionState,
    files,
    error,
    currentStrategy,
    sendFiles,
    verificationCode,
    isVerified,
    submitVerificationCode,
  };
}
