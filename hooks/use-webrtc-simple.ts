"use client";

import { useState, useEffect, useCallback } from "react";
import PeerManager, { ConnectionState } from "@/services/peer-manager";
import { LogEntry } from "@/components/connection-logger";

interface FileTransfer {
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
  onFileReceived?: (
    file: Blob,
    metadata: { name: string; type: string }
  ) => void;
  onLog?: (log: LogEntry) => void;
}

export function useWebRTC({
  role,
  sessionId,
  onFileReceived,
  onLog,
}: UseWebRTCProps) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("waiting");
  const [files, setFiles] = useState<FileTransfer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState<string | null>(null);
  const [isVerified, setIsVerified] = useState(false);

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

  useEffect(() => {
    const peerManager = PeerManager.getInstance();

    const unsubscribe = peerManager.subscribe({
      onConnectionStateChange: (state: string) => {
        setConnectionState(state as ConnectionState);
        
        // Update other state from peer manager
        const managerState = peerManager.getState();
        setFiles(managerState.files);
        setError(managerState.error);
        setVerificationCode(managerState.verificationCode);
        setIsVerified(managerState.isVerified);
      },
      onFileReceived,
      onLog,
    });

    // Initialize connection
    peerManager.connect(role, sessionId).then((peerId) => {
      log("success", `Connected with peer ID: ${peerId}`);
    }).catch((err: Error) => {
      log("error", "Failed to connect", String(err));
    });

    return () => {
      unsubscribe();
      // Don't disconnect here to allow reconnection
    };
  }, [role, sessionId, onFileReceived, onLog, log]);

  const sendFiles = useCallback(async (filesToSend: File[]) => {
    const peerManager = PeerManager.getInstance();
    await peerManager.sendFiles(filesToSend);
  }, []);

  const submitVerificationCode = useCallback((enteredCode: string) => {
    const peerManager = PeerManager.getInstance();
    return peerManager.submitVerificationCode(enteredCode);
  }, []);

  const disconnect = useCallback(() => {
    const peerManager = PeerManager.getInstance();
    peerManager.disconnect();
  }, []);

  return {
    connectionState,
    files,
    error,
    sendFiles,
    verificationCode,
    isVerified,
    submitVerificationCode,
    disconnect,
  };
}
