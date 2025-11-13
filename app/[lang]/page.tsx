
"use client";

import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowUpDown, ClipboardPaste, ClipboardCopy, Shield, Zap, Users, Copy, Trash2, X, Send } from "lucide-react";
import { QRCodeGenerator } from "@/components/qr-code-generator";
import { ConnectionStatus } from "@/components/connection-status";
import { ConnectionLogger, LogEntry } from "@/components/connection-logger";
import { toast } from "sonner";
import PeerManager, { ConnectionState } from "@/services/peer-manager";
import { LanguageSwitcher } from "@/components/language-switcher";
import { getTranslations } from "@/lib/client-i18n";
import BuyMeACoffee from "@/components/BuyMeACoffee";

interface ClipboardItem {
  id: string;
  content: string;
  timestamp: number;
  isLocal: boolean;
}

export default function ClipboardPage({ params }: { params: Promise<{ lang: string }> }) {
  const [lang, setLang] = useState<"en" | "zh">("en");
  const [t, setT] = useState(() => getTranslations("en"));

  const [peerId, setPeerId] = useState<string>("");
  const [shortCode, setShortCode] = useState<string>("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [enteredCode, setEnteredCode] = useState<string>("");
  const [connectionState, setConnectionState] = useState<ConnectionState>("waiting");
  const [error, setError] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState<string | null>(null);
  const [isVerified, setIsVerified] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [textContent, setTextContent] = useState<string>("");
  const [clipboardHistory, setClipboardHistory] = useState<ClipboardItem[]>([]);
  const [manualCode, setManualCode] = useState<string>("");
  const searchParams = useSearchParams();

  const handleLog = (log: LogEntry) => {
    setLogs((prev) => [...prev, log]);
  };

  const handleTextReceived = (text: string) => {
    const newItem: ClipboardItem = {
      id: `${Date.now()}-${Math.random()}`,
      content: text,
      timestamp: Date.now(),
      isLocal: false
    };

    setClipboardHistory(prev => [newItem, ...prev]);
    saveClipboardHistory([newItem, ...clipboardHistory]);
    toast.success(`${t("clipboard.contentReceived")}: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
  };

  const saveClipboardHistory = (history: ClipboardItem[]) => {
    try {
      localStorage.setItem('p2p-clipboard-history', JSON.stringify(history));
    } catch (err) {
      console.error('Failed to save clipboard history:', err);
    }
  };

  const loadClipboardHistory = (): ClipboardItem[] => {
    try {
      const saved = localStorage.getItem('p2p-clipboard-history');
      return saved ? JSON.parse(saved) : [];
    } catch (err) {
      console.error('Failed to load clipboard history:', err);
      return [];
    }
  };

  useEffect(() => {
    setClipboardHistory(loadClipboardHistory());
  }, []);

  useEffect(() => {
    const loadParams = async () => {
      const resolvedParams = await params;
      const validLang = resolvedParams.lang === "zh" ? "zh" : "en";
      setLang(validLang);
      setT(() => getTranslations(validLang));
    };
    loadParams();
  }, [params]);

  useEffect(() => {
    const peerManager = PeerManager.getInstance();

    // Subscribe to state changes
    const unsubscribe = peerManager.subscribe({
      onConnectionStateChange: (state: ConnectionState) => {
        setConnectionState(state);

        // Update other state from peer manager
        const managerState = peerManager.getState();
        setError(managerState.error);
        setVerificationCode(managerState.verificationCode);
        setIsVerified(managerState.isVerified);

        // Update peer ID when available
        if (managerState.peerId && !peerId) {
          setPeerId(managerState.peerId);

          // Register short code when peer ID is available
          registerShortCode(managerState.peerId);
        }
      },
      onLog: handleLog,
    });

    // Check if we have a session parameter (coming from QR code scan)
    const sessionId = searchParams?.get("session");

    if (sessionId) {
      // We're connecting to an existing device
      handleLog({ timestamp: new Date(), level: "info", message: "Connecting to existing device via QR code", details: `Session: ${sessionId}` });

      const connectWithShortCode = async () => {
        try {
          // Check if sessionId is a short code (6 characters alphanumeric)
          if (sessionId.length === 6 && /^[A-Z0-9]{6}$/i.test(sessionId)) {
            // Lookup peer ID from short code
            handleLog({ timestamp: new Date(), level: "info", message: "Looking up peer ID from short code", details: `Code: ${sessionId}` });
            const response = await fetch(`/api/codes?shortCode=${sessionId}`);
            const data = await response.json();

            if (data.success) {
              handleLog({ timestamp: new Date(), level: "success", message: "Found peer ID from short code", details: `Peer ID: ${data.peerId}` });
              // Connect using the full peer ID
              await peerManager.connect("sender", data.peerId);
            } else {
              handleLog({ timestamp: new Date(), level: "error", message: "Failed to lookup short code", details: data.error });
              setError("Invalid connection code - please check and try again");
              return;
            }
          } else {
            // Assume it's a full peer ID (backward compatibility)
            handleLog({ timestamp: new Date(), level: "info", message: "Using direct peer ID connection" });
            await peerManager.connect("sender", sessionId);
          }
        } catch (err) {
          console.error("Failed to connect as sender:", err);
          setError("Failed to connect to device");
        }
      };

      connectWithShortCode();
    } else {
      // We're waiting for connections (acting as receiver)
      peerManager.connect("receiver", "").then((id) => {
        console.log("Waiting for connections with peer ID:", id);
        setPeerId(id);
        registerShortCode(id);
      }).catch((err) => {
        console.error("Failed to initialize:", err);
        setError(t("clipboard.connectionFailed"));
      });
    }

    return () => {
      unsubscribe();
    };
  }, [searchParams]);

  const registerShortCode = async (peerId: string) => {
    try {
      const response = await fetch("/api/codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ peerId }),
      });

      const data = await response.json();

      if (data.success) {
        setShortCode(data.shortCode);
        handleLog({ timestamp: new Date(), level: "success", message: `${t("clipboard.shortCodeGenerated")}: ${data.shortCode}` });
      } else {
        // Fallback to using peer ID if short code generation fails
        setShortCode(peerId);
        handleLog({ timestamp: new Date(), level: "warning", message: t("clipboard.shortCodeFailed"), details: data.error });
      }
    } catch (err) {
      // Fallback to using peer ID if API call fails
      setShortCode(peerId);
      handleLog({ timestamp: new Date(), level: "warning", message: t("clipboard.registerFailed"), details: String(err) });
    }
  };

  const handleVerificationSubmit = () => {
    if (enteredCode.trim().length === 6) {
      const peerManager = PeerManager.getInstance();
      const success = peerManager.submitVerificationCode(enteredCode.trim());
      if (!success) {
        toast.error(t("clipboard.verificationFailed"));
      }
    } else {
      toast.error(t("clipboard.enter6DigitCode"));
    }
  }

  const connectionUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/${lang}/?session=${shortCode || peerId}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(connectionUrl);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
      toast.success(t("clipboard.linkCopied"));
    } catch (err) {
      toast.error(t("clipboard.copyFailed"));
    }
  };

  const handleSendText = async () => {
    if (!textContent.trim()) {
      setError("Please enter some text to share");
      return;
    }

    if (connectionState !== "connected") {
      setError("No active connection. Please verify the connection first.");
      return;
    }

    try {
      const peerManager = PeerManager.getInstance();
      // For now, we'll use sendFiles as a workaround until we update peer manager
      // await peerManager.sendText(textContent);

      // Add to local history
      const newItem: ClipboardItem = {
        id: `${Date.now()}-${Math.random()}`,
        content: textContent,
        timestamp: Date.now(),
        isLocal: true
      };

      setClipboardHistory(prev => [newItem, ...prev]);
      saveClipboardHistory([newItem, ...clipboardHistory]);
      setTextContent("");
      toast.success(t("clipboard.contentSent"));
      handleLog({ timestamp: new Date(), level: "success", message: "Content shared successfully" });
    } catch (err) {
      console.error("Failed to send text:", err);
      setError("Failed to share content");
      handleLog({ timestamp: new Date(), level: "error", message: "Failed to share content", details: String(err) });
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      const clipboardText = await navigator.clipboard.readText();
      setTextContent(clipboardText);
      handleLog({ timestamp: new Date(), level: "info", message: "Text pasted from clipboard" });
    } catch (err) {
      setError("Failed to read from clipboard");
      handleLog({ timestamp: new Date(), level: "error", message: "Failed to read from clipboard", details: String(err) });
    }
  };

  const handleCopyToClipboard = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      toast.success(t("common.copied"));
    } catch (err) {
      toast.error("Failed to copy to clipboard");
    }
  };

  const handleDeleteItem = (id: string) => {
    const newHistory = clipboardHistory.filter(item => item.id !== id);
    setClipboardHistory(newHistory);
    saveClipboardHistory(newHistory);
  };

  const handleClearAll = () => {
    setClipboardHistory([]);
    saveClipboardHistory([]);
  };

  const handleManualCodeSubmit = async () => {
    if (manualCode.trim()) {
      const peerManager = PeerManager.getInstance();

      try {
        // Check if manualCode is a short code (6 characters alphanumeric)
        if (manualCode.length === 6 && /^[A-Z0-9]{6}$/i.test(manualCode)) {
          // Lookup peer ID from short code
          handleLog({ timestamp: new Date(), level: "info", message: "Looking up peer ID from short code", details: `Code: ${manualCode}` });
          const response = await fetch(`/api/codes?shortCode=${manualCode}`);
          const data = await response.json();

          if (data.success) {
            handleLog({ timestamp: new Date(), level: "success", message: "Found peer ID from short code", details: `Peer ID: ${data.peerId}` });
            // Connect using the full peer ID
            await peerManager.connect("sender", data.peerId);
          } else {
            handleLog({ timestamp: new Date(), level: "error", message: "Failed to lookup short code", details: data.error });
            setError("Invalid connection code - please check and try again");
            return;
          }
        } else {
          // Assume it's a full peer ID (backward compatibility)
          handleLog({ timestamp: new Date(), level: "info", message: "Using direct peer ID connection" });
          await peerManager.connect("sender", manualCode);
        }
      } catch (err) {
        console.error("Failed to connect:", err);
        setError("Failed to connect to device");
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50">
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <ArrowUpDown className="w-8 h-8 text-blue-600" />
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-green-600 bg-clip-text text-transparent">
                {t("home.title")}
              </h1>
            </div>
            <LanguageSwitcher currentLocale={lang} />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Connection Panel */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
              <ConnectionStatus
                state={connectionState}
                role="receiver"
              />

              {error && (
                <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {error}
                </div>
              )}

              {/* Waiting for connection */}
              {(connectionState === "waiting" || connectionState === "connecting") && (
                <div className="text-center">
                  {!peerId ? (
                    <div className="text-center py-8">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                      <p className="text-gray-600">{t("clipboard.initializing")}</p>
                    </div>
                  ) : (
                    <>
                      <div className="mb-6">
                        <h2 className="text-xl font-bold text-gray-900 mb-4">
                          {t("clipboard.readyToShare")}
                        </h2>
                        <p className="text-gray-600 text-sm mb-6">
                          {t("clipboard.askOtherDevice")}
                        </p>
                      </div>

                      <div className="mb-6">
                        <QRCodeGenerator url={connectionUrl} />
                      </div>

                      {/* Copy Link Button */}
                      <div className="mb-6">
                        <button
                          onClick={handleCopyLink}
                          disabled={!peerId}
                          className="w-full flex items-center justify-center space-x-2 bg-blue-600 text-white px-4 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Copy className="w-4 h-4" />
                          <span>{copySuccess ? t("common.copied") : t("common.copyLink")}</span>
                        </button>
                        <p className="text-xs text-gray-600 text-center mt-2">
                          {t("clipboard.copyLinkDescription")}
                        </p>
                      </div>

                      <div className="bg-gradient-to-r from-blue-50 to-green-50 rounded-lg p-4 mb-6">
                        <p className="text-sm font-semibold text-gray-700 mb-2 text-center">
                          {t("clipboard.connectionCode")}
                        </p>
                        <div className="bg-white border-2 border-blue-300 rounded-lg p-3 mb-2">
                          <p className="text-xl font-bold text-center font-mono tracking-wider text-blue-600">
                            {shortCode ? shortCode : (peerId ? t("common.generating") : t("common.connecting"))}
                          </p>
                        </div>
                        <p className="text-xs text-gray-600 text-center">
                          {t("clipboard.shareCode")}
                        </p>
                      </div>

                      {/* Manual Connection */}
                      <div className="border-t pt-4">
                        <p className="text-sm font-medium text-gray-700 mb-2">Or connect to another device:</p>
                        <div className="flex space-x-2">
                          <input
                            type="text"
                            value={manualCode}
                            onChange={(e) => setManualCode(e.target.value.replace(/[^a-zA-Z0-9]/g, ""))}
                            placeholder="Enter code"
                            className="flex-1 px-3 py-2 text-center font-mono uppercase border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                          />
                          <button
                            onClick={handleManualCodeSubmit}
                            disabled={!manualCode.trim()}
                            className="bg-green-600 text-white px-4 py-2 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-green-700 transition-colors"
                          >
                            Connect
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Verifying - Sender (generated QR code) shows verification code display */}
              {connectionState === "verifying" && verificationCode && (
                <div className="text-center">
                  <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-6">
                    <h2 className="text-lg font-bold text-gray-900 mb-4">
                      {t("common.verificationRequired")}
                    </h2>

                    <p className="text-gray-600 text-sm mb-4">
                      {t("clipboard.askOtherDeviceToVerify")}
                    </p>

                    <div className="mb-4 p-3 bg-white border-2 border-yellow-400 rounded-lg">
                      <p className="text-xs text-gray-600 mb-1">{t("common.senderVerificationCode")}:</p>
                      <div className="text-lg font-bold font-mono tracking-widest text-yellow-600">
                        {verificationCode}
                      </div>
                    </div>

                    <p className="text-xs text-gray-600 mt-3">
                      {t("clipboard.verificationDescription")}
                    </p>
                  </div>
                </div>
              )}

              {/* Verifying - Receiver (connected via QR code) shows verification input */}
              {connectionState === "verifying" && !verificationCode && (
                <div className="text-center">
                  <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-6">
                    <h2 className="text-lg font-bold text-gray-900 mb-4">
                      {t("common.verificationRequired")}
                    </h2>

                    <p className="text-gray-600 text-sm mb-4">
                      {t("clipboard.enterVerificationCode")}
                    </p>

                    <div className="mb-4">
                      <input
                        type="text"
                        value={enteredCode}
                        onChange={(e) => {
                          const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                          setEnteredCode(value);
                        }}
                        placeholder={t("clipboard.codePlaceholder")}
                        maxLength={6}
                        className="w-full px-3 py-3 text-center text-xl font-bold font-mono tracking-widest border-2 border-yellow-400 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                      />
                    </div>
                    <button
                      onClick={handleVerificationSubmit}
                      disabled={enteredCode.length !== 6}
                      className="w-full bg-yellow-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-yellow-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t("clipboard.verifyConnection")}
                    </button>

                    <p className="text-xs text-gray-600 mt-3">
                      {t("clipboard.verificationDescription")}
                    </p>
                  </div>
                </div>
              )}

              {/* Connected */}
              {(connectionState === "connected" || connectionState === "transferring") && (
                <div className="text-center">
                  <div className="bg-green-50 border-2 border-green-300 rounded-lg p-6">
                    <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Users className="w-6 h-6 text-green-600" />
                    </div>
                    <h2 className="text-lg font-bold text-gray-900 mb-2">
                      {t("connectionStatus.connectedAndReady")}
                    </h2>
                    <p className="text-sm text-gray-600">
                      You are connected and can share clipboard content
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Connection Logs */}
            <div className="mt-6">
              <ConnectionLogger logs={logs} maxHeight="300px" />
            </div>
          </div>

          {/* Clipboard Content Panel */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">{t("clipboard.title")}</h2>
                {clipboardHistory.length > 0 && (
                  <button
                    onClick={handleClearAll}
                    className="flex items-center space-x-2 text-red-600 hover:text-red-700 text-sm font-medium"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>{t("clipboard.clearAll")}</span>
                  </button>
                )}
              </div>

              {/* Text Input Area */}
              <div className="mb-6">
                <div className="border-2 border-gray-300 rounded-lg p-4">
                  <textarea
                    value={textContent}
                    onChange={(e) => setTextContent(e.target.value)}
                    placeholder={t("clipboard.textPlaceholder")}
                    className="w-full h-32 p-3 border-none resize-none focus:outline-none focus:ring-0"
                    disabled={connectionState !== "connected"}
                  />
                  <div className="flex justify-between items-center mt-2">
                    <button
                      onClick={handlePasteFromClipboard}
                      className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                      disabled={connectionState !== "connected"}
                    >
                      {t("clipboard.pasteTextHere")}
                    </button>
                    <span className="text-sm text-gray-500">
                      {textContent.length} characters
                    </span>
                  </div>
                </div>

                <button
                  onClick={handleSendText}
                  disabled={!textContent.trim() || connectionState !== "connected"}
                  className="w-full bg-green-600 text-white px-6 py-3 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-green-700 transition-colors flex items-center justify-center space-x-2 mt-4"
                >
                  <Send className="w-4 h-4" />
                  <span>{t("clipboard.sendButton")}</span>
                </button>

                <p className="text-sm text-gray-500 text-center mt-2">
                  {t("clipboard.multipleContentSupported")}
                </p>
              </div>

              {/* Clipboard History */}
              <div>
                <h3 className="text-lg font-semibold mb-4">{t("clipboard.clipboardHistory")}</h3>

                {clipboardHistory.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <ClipboardPaste className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <p>{t("clipboard.noHistory")}</p>
                    <p className="text-sm mt-2">{t("clipboard.historyDescription")}</p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {clipboardHistory.map((item) => (
                      <div
                        key={item.id}
                        className={`border rounded-lg p-4 ${
                          item.isLocal ? 'bg-blue-50 border-blue-200' : 'bg-green-50 border-green-200'
                        }`}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-xs text-gray-500">
                            {new Date(item.timestamp).toLocaleString()}
                            {item.isLocal ? ' (Sent)' : ' (Received)'}
                          </span>
                          <div className="flex space-x-2">
                            <button
                              onClick={() => handleCopyToClipboard(item.content)}
                              className="text-blue-600 hover:text-blue-700"
                              title="Copy"
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteItem(item.id)}
                              className="text-red-600 hover:text-red-700"
                              title="Delete"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        <p className="text-sm whitespace-pre-wrap break-words">
                          {item.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <BuyMeACoffee language={lang === "zh" ? "zh-TW" : "en"} />
      </main>
    </div>
  );
}