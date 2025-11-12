"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, Smartphone, Shield, Clock } from "lucide-react";
import Link from "next/link";
import { QRCodeGenerator } from "@/components/qr-code-generator";
import { ConnectionStatus } from "@/components/connection-status";
import { ConnectionLogger, LogEntry } from "@/components/connection-logger";
import { useWebRTC } from "@/hooks/use-webrtc";
import { toast } from "sonner";

export default function ReceivePage() {
  const [sessionId, setSessionId] = useState<string>("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [receivedFiles, setReceivedFiles] = useState<Array<{ name: string; blob: Blob }>>([]);
  const [enteredCode, setEnteredCode] = useState<string>("");

  // Generate session ID on client side only to avoid hydration mismatch
  useEffect(() => {
    if (!sessionId) {
      setSessionId(Math.random().toString(36).substr(2, 9));
    }
  }, [sessionId]);

  const handleLog = (log: LogEntry) => {
    setLogs((prev) => [...prev, log]);
  };

  const handleFileReceived = (file: Blob, metadata: { name: string; type: string }) => {
    setReceivedFiles((prev) => [...prev, { name: metadata.name, blob: file }]);
    toast.success(`File received: ${metadata.name}`);

    // Auto-download
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = metadata.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const { connectionState, files, error, currentStrategy, verificationCode, isVerified, submitVerificationCode } = useWebRTC({
    role: "receiver",
    sessionId,
    onFileReceived: handleFileReceived,
    onLog: handleLog,
  })

  const handleVerificationSubmit = () => {
    if (enteredCode.trim().length === 6) {
      const success = submitVerificationCode(enteredCode.trim());
      if (!success) {
        toast.error("Failed to submit verification code");
      }
    } else {
      toast.error("Please enter a 6-digit code");
    }
  }

  const connectionUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/send?session=${sessionId}`;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50">
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-sm border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link
              href="/"
              className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Back to Home</span>
            </Link>
            <h1 className="text-xl font-bold text-gray-900">Receive Files</h1>
            <div className="w-20" />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl shadow-lg border border-gray-200">
              <div className="p-8">
                <ConnectionStatus
                  state={connectionState}
                  role="receiver"
                  filesCount={files.length}
                />

                {error && (
                  <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                    {error}
                  </div>
                )}

                {currentStrategy && (
                  <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm">
                    <strong>Connection Method:</strong> {currentStrategy === "webrtc-peerjs" ? "WebRTC (PeerJS)" : currentStrategy === "webrtc-custom" ? "WebRTC (Custom)" : "Server Relay"}
                  </div>
                )}

                {/* Waiting for connection */}
                {(connectionState === "waiting" || connectionState === "connecting") && (
                  <div className="text-center">
                    {!sessionId ? (
                      <div className="text-center py-8">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                        <p className="text-gray-600">Initializing...</p>
                      </div>
                    ) : (
                      <>
                        <div className="mb-8">
                          <Smartphone className="w-16 h-16 text-blue-600 mx-auto mb-4" />
                          <h2 className="text-2xl font-bold text-gray-900 mb-4">
                            Ready to Receive Files
                          </h2>
                          <p className="text-gray-600 mb-8">
                            Ask the sender to scan this QR code or enter the connection code
                          </p>
                        </div>

                        <div className="max-w-sm mx-auto mb-8">
                          <QRCodeGenerator url={connectionUrl} />
                        </div>

                        <div className="bg-gradient-to-r from-blue-50 to-green-50 rounded-lg p-6 mb-6">
                          <p className="text-sm font-semibold text-gray-700 mb-3 text-center">
                            Connection Code
                          </p>
                          <div className="bg-white border-2 border-blue-300 rounded-lg p-4 mb-3">
                            <p className="text-3xl font-bold text-center font-mono tracking-wider text-blue-600">
                              {sessionId.toUpperCase()}
                            </p>
                          </div>
                          <p className="text-xs text-gray-600 text-center">
                            Share this code with the sender to connect manually
                          </p>
                        </div>

                        <div className="flex items-center justify-center space-x-4 text-sm text-gray-500">
                          <div className="flex items-center space-x-2">
                            <Shield className="w-4 h-4" />
                            <span>Encrypted</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Clock className="w-4 h-4" />
                            <span>15 min timeout</span>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Verifying */}
                {connectionState === "verifying" && (
                  <div className="text-center py-8">
                    <div className="max-w-md mx-auto bg-yellow-50 border-2 border-yellow-300 rounded-lg p-8">
                      <Shield className="w-16 h-16 text-yellow-600 mx-auto mb-4" />
                      <h2 className="text-2xl font-bold text-gray-900 mb-4">
                        Verification Required
                      </h2>

                      {verificationCode ? (
                        <>
                          <p className="text-gray-600 mb-6">
                            Please enter the 6-digit verification code shown on the sender's device:
                          </p>
                          <div className="mb-6">
                            <input
                              type="text"
                              value={enteredCode}
                              onChange={(e) => {
                                const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                                setEnteredCode(value);
                              }}
                              placeholder="000000"
                              maxLength={6}
                              className="w-full px-4 py-4 text-center text-4xl font-bold font-mono tracking-widest border-2 border-yellow-400 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                            />
                          </div>
                          <button
                            onClick={handleVerificationSubmit}
                            disabled={enteredCode.length !== 6}
                            className="w-full bg-yellow-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-yellow-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Verify Connection
                          </button>
                        </>
                      ) : (
                        <>
                          <p className="text-gray-600 mb-6">
                            Waiting for verification code from sender...
                          </p>
                          <div className="animate-pulse text-gray-400 text-lg mb-6">
                            Please wait while the sender generates the code
                          </div>
                        </>
                      )}

                      <p className="text-sm text-gray-600 mt-4">
                        This ensures you're connecting to the right sender
                      </p>
                    </div>
                  </div>
                )}

                {/* Connected and receiving */}
                {(connectionState === "connected" || connectionState === "transferring") && (
                  <div className="mt-6">
                    <h3 className="text-lg font-semibold mb-4">File Transfer Progress</h3>
                    {files.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        <p>Waiting for files...</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {files.map((file) => (
                          <div
                            key={file.id}
                            className="border rounded-lg p-4 bg-gray-50"
                          >
                            <div className="flex justify-between items-center mb-2">
                              <span className="font-medium truncate">{file.name}</span>
                              <span className="text-sm text-gray-500">
                                {(file.size / 1024 / 1024).toFixed(2)} MB
                              </span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div
                                className="bg-blue-600 h-2 rounded-full transition-all"
                                style={{ width: `${file.progress}%` }}
                              />
                            </div>
                            <div className="mt-1 text-xs text-gray-600">
                              {file.status === "completed" ? "✓ Complete" : `${Math.round(file.progress)}%`}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Disconnected */}
                {connectionState === "disconnected" && (
                  <div className="text-center">
                    <div className="mb-6">
                      <h2 className="text-2xl font-bold text-gray-900 mb-4">
                        Connection Closed
                      </h2>
                      <p className="text-gray-600 mb-8">
                        The connection has been terminated. You can start a new session by refreshing.
                      </p>
                    </div>
                    <button
                      onClick={() => window.location.reload()}
                      className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
                    >
                      Start New Session
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Connection Logs Sidebar */}
          <div className="lg:col-span-1">
            <ConnectionLogger logs={logs} maxHeight="600px" />
          </div>
        </div>
      </main>
    </div>
  );
}
