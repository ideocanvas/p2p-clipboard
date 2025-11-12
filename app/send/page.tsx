"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Upload } from "lucide-react";
import Link from "next/link";
import { ConnectionStatus } from "@/components/connection-status";
import { ConnectionLogger, LogEntry } from "@/components/connection-logger";
import { useWebRTC } from "@/hooks/use-webrtc";

function SendPageContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams?.get("session");
  const [manualCode, setManualCode] = useState<string>("");
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const handleLog = (log: LogEntry) => {
    setLogs((prev) => [...prev, log]);
  };

  const { connectionState, files, error, currentStrategy, sendFiles, verificationCode, isVerified } = useWebRTC({
    role: "sender",
    sessionId: sessionId || "",
    onLog: handleLog,
  })

  const handleManualCodeSubmit = () => {
    if (manualCode.trim()) {
      window.location.href = `/send?session=${manualCode.toLowerCase()}`;
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (fileList && fileList.length > 0) {
      const filesArray = Array.from(fileList);
      await sendFiles(filesArray);
    }
  };

  if (!sessionId) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="text-center">
            <Upload className="w-16 h-16 text-green-600 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Connect to Receiver</h2>
            <p className="text-gray-600 mb-8">
              Enter the connection code shown on the receiver&apos;s device
            </p>

            <div className="max-w-md mx-auto">
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Connection Code
                </label>
                <input
                  type="text"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value.replace(/[^a-zA-Z0-9]/g, ""))}
                  placeholder="Enter code from receiver"
                  className="w-full px-4 py-3 text-center text-xl font-mono uppercase border-2 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                />
              </div>
              <button
                onClick={handleManualCodeSubmit}
                disabled={!manualCode.trim()}
                className="w-full bg-green-600 text-white px-6 py-3 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-green-700 transition-colors mb-4"
              >
                Connect
              </button>

              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-300"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-white text-gray-500">or</span>
                </div>
              </div>

              <Link href="/" className="text-green-600 hover:text-green-700 font-medium">
                ← Scan QR Code Instead
              </Link>
            </div>
          </div>
        </div>
        <div className="lg:col-span-1">
          <ConnectionLogger logs={logs} maxHeight="400px" />
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2">
        <ConnectionStatus state={connectionState} role="sender" filesCount={files.length} />

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {currentStrategy && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm">
            <strong>Connection Method:</strong>{" "}
            {currentStrategy === "webrtc-peerjs"
              ? "WebRTC (PeerJS)"
              : currentStrategy === "webrtc-custom"
              ? "WebRTC (Custom)"
              : "Server Relay"}
          </div>
        )}

        {/* Connecting */}
        {connectionState === "connecting" && (
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Connecting to Receiver</h2>
            <p className="text-gray-600">Establishing connection...</p>
          </div>
        )}

        {/* Verifying */}
        {connectionState === "verifying" && (
          <div className="text-center py-8">
            <div className="max-w-md mx-auto bg-yellow-50 border-2 border-yellow-300 rounded-lg p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Verification Required</h2>
              <p className="text-gray-600 mb-6">
                Please share this code with the receiver for verification:
              </p>
              <div className="bg-white border-4 border-yellow-400 rounded-lg p-6 mb-6">
                <div className="text-4xl font-bold text-gray-900 tracking-widest">
                  {verificationCode ? (
                    verificationCode
                  ) : (
                    <div className="animate-pulse text-gray-400">Generating...</div>
                  )}
                </div>
              </div>
              <p className="text-sm text-gray-600">
                The receiver must enter this code to establish a secure connection
              </p>
            </div>
          </div>
        )}

        {/* Connected and ready to send */}
        {(connectionState === "connected" || connectionState === "transferring") && (
          <div className="mt-6">
            <h3 className="text-lg font-semibold mb-4">Send Files</h3>

            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-green-500 transition-colors">
              <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <label className="cursor-pointer">
                <span className="text-green-600 font-semibold hover:text-green-700">
                  Click to select files
                </span>
                <input
                  type="file"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                  disabled={connectionState === "transferring"}
                />
              </label>
              <p className="text-sm text-gray-500 mt-2">Multiple files supported • No size limit</p>
            </div>

            {files.length > 0 && (
              <div className="mt-6 space-y-3">
                {files.map((file) => (
                  <div key={file.id} className="border rounded-lg p-4 bg-gray-50">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-medium truncate">{file.name}</span>
                      <span className="text-sm text-gray-500">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-green-600 h-2 rounded-full transition-all"
                        style={{ width: `${file.progress}%` }}
                      />
                    </div>
                    <div className="mt-1 text-xs text-gray-600">
                      {file.status === "completed" ? "✓ Sent" : `${Math.round(file.progress)}%`}
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
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Connection Closed</h2>
              <p className="text-gray-600 mb-8">
                The connection has been terminated. Please scan a new QR code to start a new
                session.
              </p>
            </div>
            <Link
              href="/"
              className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
            >
              Back to Home
            </Link>
          </div>
        )}
      </div>

      <div className="lg:col-span-1">
        <ConnectionLogger logs={logs} maxHeight="600px" />
      </div>
    </div>
  );
}

export default function SendPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-blue-50">
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
            <h1 className="text-xl font-bold text-gray-900">Send Files</h1>
            <div className="w-20" />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <Suspense fallback={<div>Loading...</div>}>
          <SendPageContent />
        </Suspense>
      </main>
    </div>
  );
}
