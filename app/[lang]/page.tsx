
"use client";

import BuyMeACoffee from "@/components/BuyMeACoffee";
import { ClipboardHistoryItem as ClipboardHistoryItemComponent } from "@/components/clipboard-history-item";
import { ConnectionLogger, LogEntry } from "@/components/connection-logger";
import { ConnectionStatus } from "@/components/connection-status";
import { LanguageSwitcher } from "@/components/language-switcher";
import { QRCodeGenerator } from "@/components/qr-code-generator";
import { getTranslations } from "@/lib/client-i18n";
import { createClipboardHistoryItem, detectContentType } from "@/lib/clipboard-utils";
import { indexedDBStorage } from "@/lib/indexed-db";
import { ClipboardHistoryItem as ClipboardHistoryItemType } from "@/lib/types";
import PeerManager, { ConnectionState } from "@/services/peer-manager";
import { ArrowUpDown, ClipboardPaste, Copy, Send, Trash2, Users } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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
  const [clipboardHistory, setClipboardHistory] = useState<ClipboardHistoryItemType[]>([]);
  const [manualCode, setManualCode] = useState<string>("");
  const [isDragOver, setIsDragOver] = useState(false);
  const searchParams = useSearchParams();

  const handleLog = (log: LogEntry) => {
    setLogs((prev) => [...prev, log]);
  };

  const handleTextReceived = (text: string, contentType: string = 'text') => {
    const newItem: ClipboardHistoryItemType = {
      id: `${Date.now()}-${Math.random()}`,
      type: contentType as ClipboardHistoryItemType['type'],
      content: text,
      timestamp: Date.now(),
      isLocal: false
    };

    setClipboardHistory(prev => [newItem, ...prev]);
    saveClipboardHistory([newItem, ...clipboardHistory]);
    toast.success(`${t("clipboard.contentReceived")}: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
  };

  const handleFileReceived = (file: Blob, metadata: { name: string; type: string }) => {
    const fileType = metadata.type.startsWith('image/') ? 'image' : 'file';
    const previewUrl = metadata.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;

    const newItem: ClipboardHistoryItemType = {
      id: `${Date.now()}-${Math.random()}`,
      type: fileType,
      content: `${fileType === 'image' ? 'Image' : 'File'}: ${metadata.name}`,
      data: file,
      mimeType: metadata.type,
      fileName: metadata.name,
      fileSize: file.size,
      timestamp: Date.now(),
      isLocal: false,
      previewUrl
    };

    setClipboardHistory(prev => [newItem, ...prev]);
    saveClipboardHistory([newItem, ...clipboardHistory]);
    toast.success(`${t("clipboard.contentReceived")}: ${metadata.name}`);
  };

  const saveClipboardHistory = async (history: ClipboardHistoryItemType[]) => {
    try {
      // Store file data in IndexedDB and metadata in localStorage
      const fileItems = history.filter(item => item.type === 'image' || item.type === 'file');
      const nonFileItems = history.filter(item => item.type !== 'image' && item.type !== 'file');

      // Store file data in IndexedDB
      for (const item of fileItems) {
        if (item.data) {
          let fileToStore: File;
          if (item.data instanceof File) {
            fileToStore = item.data;
          } else if (item.data instanceof Blob) {
            // Convert Blob to File for storage
            fileToStore = new File([item.data], item.fileName || 'received-file', {
              type: item.mimeType || 'application/octet-stream'
            });
          } else {
            continue; // Skip if data is not a File or Blob
          }
          await indexedDBStorage.storeFile(item.id, fileToStore);
        }
      }

      // Store metadata in localStorage (without file data)
      const serializableHistory = history.map(item => {
        const serializedItem = { ...item };
        // Remove previewUrl as it's not serializable
        delete serializedItem.previewUrl;
        // Remove data (Blob) as it's not serializable
        delete serializedItem.data;
        return serializedItem;
      });
      localStorage.setItem('p2p-clipboard-history', JSON.stringify(serializableHistory));
    } catch (err) {
      console.error('Failed to save clipboard history:', err);
    }
  };

  const loadClipboardHistory = async (): Promise<ClipboardHistoryItemType[]> => {
    try {
      const saved = localStorage.getItem('p2p-clipboard-history');
      if (!saved) return [];

      const history: ClipboardHistoryItemType[] = JSON.parse(saved);

      // Load file data from IndexedDB for file/image items
      const loadedHistory = await Promise.all(
        history.map(async (item) => {
          if (item.type === 'image' || item.type === 'file') {
            try {
              const file = await indexedDBStorage.getFile(item.id);
              if (file) {
                const previewUrl = item.type === 'image' ? URL.createObjectURL(file) : undefined;
                return {
                  ...item,
                  data: file,
                  previewUrl
                };
              }
            } catch (err) {
              console.error(`Failed to load file ${item.id}:`, err);
            }
          }
          return item;
        })
      );

      return loadedHistory;
    } catch (err) {
      console.error('Failed to load clipboard history:', err);
      return [];
    }
  };

  useEffect(() => {
    const loadHistory = async () => {
      const history = await loadClipboardHistory();
      setClipboardHistory(history);
    };
    loadHistory();
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

        // Clear entered code when starting verification
        if (state === "verifying") {
          setEnteredCode("");
        }

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
      onTextReceived: handleTextReceived,
      onFileReceived: handleFileReceived,
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
      await peerManager.sendText(textContent);

      // Add to local history
      const newItem: ClipboardHistoryItemType = {
        id: `${Date.now()}-${Math.random()}`,
        type: 'text',
        content: textContent,
        timestamp: Date.now(),
        isLocal: true
      };

      const newHistory = [newItem, ...clipboardHistory];
      setClipboardHistory(newHistory);
      saveClipboardHistory(newHistory);
      setTextContent("");
      toast.success(t("clipboard.contentSent"));
      handleLog({ timestamp: new Date(), level: "success", message: "Content shared successfully" });
    } catch (err) {
      console.error("Failed to send text:", err);
      setError("Failed to share content");
      handleLog({ timestamp: new Date(), level: "error", message: "Failed to share content", details: String(err) });
    }
  };

  const handleClearText = () => {
    setTextContent("");
  };

  const handlePasteFromClipboard = async (event?: React.ClipboardEvent) => {
    // Always prevent default and stop propagation to handle paste ourselves
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      console.log("event", event);
    }

    try {
      // Use the traditional clipboardData approach which has better browser support
      const clipboardData = event?.clipboardData;

      if (!clipboardData) {
        // Fallback to text-only API
        try {
          const clipboardText = await navigator.clipboard.readText();
          if (clipboardText) {
            setTextContent(clipboardText);
            handleLog({ timestamp: new Date(), level: "info", message: "Text pasted from clipboard (fallback to readText)" });
          } else {
            setError("No text content found in clipboard");
          }
        } catch (fallbackErr) {
          setError("Clipboard access not supported");
          handleLog({ timestamp: new Date(), level: "error", message: "Clipboard access failed", details: String(fallbackErr) });
        }
        return;
      }

      let foundContent = false;

      // Use the utility function to detect content type
      const detectedContent = detectContentType(clipboardData);

      if (detectedContent) {
        // Create history item using utility function
        const newItem = createClipboardHistoryItem(
          detectedContent.type,
          detectedContent.content,
          detectedContent.file,
          true
        );

        // Handle file sending if connected
        if ((detectedContent.type === 'image' || detectedContent.type === 'file') &&
            connectionState === "connected" && detectedContent.file) {
          try {
            const peerManager = PeerManager.getInstance();
            await peerManager.sendFiles([detectedContent.file]);
            handleLog({
              timestamp: new Date(),
              level: "info",
              message: `${detectedContent.type} sent to connected device`
            });
          } catch (sendErr) {
            handleLog({
              timestamp: new Date(),
              level: "error",
              message: "Failed to send file",
              details: String(sendErr)
            });
          }
        }

        // Add to history
        const newHistory = [newItem, ...clipboardHistory];
        setClipboardHistory(newHistory);
        saveClipboardHistory(newHistory);

        // For text content, also show in textarea (unless it's HTML)
        if (detectedContent.type === 'text') {
          setTextContent(detectedContent.content);
        }

        // Auto-send text-based content if connected
        const textBasedTypes = ['text', 'html', 'code', 'url', 'contact', 'rich-text'];
        if (textBasedTypes.includes(detectedContent.type) && connectionState === "connected") {
          try {
            const peerManager = PeerManager.getInstance();
            await peerManager.sendText(detectedContent.content, detectedContent.type);
            handleLog({
              timestamp: new Date(),
              level: "success",
              message: `${detectedContent.type} content automatically sent to connected device`
            });
            toast.success(t("clipboard.contentSent"));
          } catch (sendErr) {
            handleLog({
              timestamp: new Date(),
              level: "error",
              message: `Failed to automatically send ${detectedContent.type} content`,
              details: String(sendErr)
            });
          }
        }

        handleLog({
          timestamp: new Date(),
          level: "info",
          message: `${detectedContent.type} content pasted from clipboard`,
          details: detectedContent.type === 'file' || detectedContent.type === 'image'
            ? `Type: ${detectedContent.file?.type}, Size: ${detectedContent.file?.size} bytes, Name: ${detectedContent.file?.name || 'unnamed'}`
            : undefined
        });

        foundContent = true;
      }

      // If we found and processed content, we're done
      if (foundContent) return;

      if (!foundContent) {
        setError("No supported content found in clipboard");
        handleLog({ timestamp: new Date(), level: "warning", message: "No supported content found in clipboard" });
      }
    } catch (err) {
      setError("Failed to process clipboard content");
      handleLog({ timestamp: new Date(), level: "error", message: "Failed to process clipboard content", details: String(err) });
    }
  };

  const handleCopyToClipboard = async (item: ClipboardHistoryItemType) => {
    try {
      switch (item.type) {
        case 'text':
        case 'html':
        case 'code':
        case 'url':
        case 'contact':
        case 'rich-text':
          await navigator.clipboard.writeText(item.content);
          toast.success(t("common.copied"));
          break;
        case 'image':
        case 'file':
          if (item.data) {
            // Ensure we have a proper Blob for clipboard operations
            let blob: Blob;
            if (item.data instanceof Blob) {
              blob = item.data;
            } else {
              // If data is not a Blob, create one from the stored data
              blob = new Blob([item.data], { type: item.mimeType || 'application/octet-stream' });
            }

            const clipboardItem = new globalThis.ClipboardItem({
              [item.mimeType || 'application/octet-stream']: blob
            });
            await navigator.clipboard.write([clipboardItem]);
            toast.success(`${item.type === 'image' ? 'Image' : 'File'} copied to clipboard`);
          } else {
            toast.error("No file data available to copy");
          }
          break;
        default:
          toast.error("Unsupported content type");
      }
    } catch (err) {
      console.error("Failed to copy to clipboard", err);
      toast.error("Failed to copy to clipboard");
    }
  };

  const handleSendItem = async (item: ClipboardHistoryItemType) => {
    if (connectionState !== "connected") {
      toast.error("No active connection");
      return;
    }

    try {
      const peerManager = PeerManager.getInstance();

      switch (item.type) {
        case 'text':
        case 'html':
        case 'code':
        case 'url':
        case 'contact':
        case 'rich-text':
          await peerManager.sendText(item.content, item.type);
          toast.success("Content sent");
          break;
        case 'image':
        case 'file':
          if (item.data) {
            const file = item.data instanceof File ? item.data : new File([item.data], item.fileName || 'file', { type: item.mimeType });
            await peerManager.sendFiles([file]);
            toast.success(`${item.type === 'image' ? 'Image' : 'File'} sent`);
          } else {
            toast.error("No file data available to send");
          }
          break;
        default:
          toast.error("Unsupported content type");
      }

      handleLog({ timestamp: new Date(), level: "success", message: "Content sent to peer" });
    } catch (err) {
      console.error('Send failed:', err);
      toast.error("Failed to send content");
      handleLog({ timestamp: new Date(), level: "error", message: "Failed to send content", details: String(err) });
    }
  };

  const handleDownloadFile = async (item: ClipboardHistoryItemType) => {
    if (!item.data) return;

    try {
      const url = URL.createObjectURL(item.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = item.fileName || `download-${item.id}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("File downloaded");
    } catch (err) {
      toast.error("Failed to download file");
    }
  };

  const handleFileDrop = async (files: globalThis.FileList | null) => {
    if (!files || files.length === 0) return;

    if (connectionState !== "connected") {
      setError("No active connection. Please verify the connection first.");
      return;
    }

    try {
      const peerManager = PeerManager.getInstance();
      const fileArray = Array.from(files);

      // Filter for supported file types
      const supportedFiles = fileArray.filter(file =>
        file.type.startsWith('image/') ||
        file.type.startsWith('text/') ||
        file.size < 50 * 1024 * 1024 // Limit to 50MB
      );

      if (supportedFiles.length === 0) {
        setError("No supported files found. Please select images or smaller files.");
        return;
      }

      await peerManager.sendFiles(supportedFiles);

      // Add files to local history
      const newItems = supportedFiles.map(file => {
        const isImage = file.type.startsWith('image/');
        const previewUrl = isImage ? URL.createObjectURL(file) : undefined;

        return {
          id: `${Date.now()}-${Math.random()}`,
          type: isImage ? 'image' : 'file',
          content: `${isImage ? 'Image' : 'File'}: ${file.name}`,
          data: file,
          mimeType: file.type,
          fileName: file.name,
          fileSize: file.size,
          timestamp: Date.now(),
          isLocal: true,
          previewUrl
        } as ClipboardHistoryItemType;
      });

      const newHistory = [...newItems, ...clipboardHistory];
      setClipboardHistory(newHistory);
      saveClipboardHistory(newHistory);

      handleLog({ timestamp: new Date(), level: "success", message: `${supportedFiles.length} file(s) sent` });
    } catch (err) {
      setError("Failed to send files");
      handleLog({ timestamp: new Date(), level: "error", message: "Failed to send files", details: String(err) });
    }
  };

  const handleDeleteItem = async (id: string) => {
    const itemToDelete = clipboardHistory.find(item => item.id === id);
    if (itemToDelete && (itemToDelete.type === 'image' || itemToDelete.type === 'file')) {
      try {
        await indexedDBStorage.deleteFile(id);
      } catch (err) {
        console.error(`Failed to delete file ${id} from IndexedDB:`, err);
      }
    }

    const newHistory = clipboardHistory.filter(item => item.id !== id);
    setClipboardHistory(newHistory);
    saveClipboardHistory(newHistory);
  };

  const handleClearAll = async () => {
    // Delete all files from IndexedDB
    try {
      const fileIds = clipboardHistory
        .filter(item => item.type === 'image' || item.type === 'file')
        .map(item => item.id);

      for (const id of fileIds) {
        await indexedDBStorage.deleteFile(id);
      }
    } catch (err) {
      console.error('Failed to clear files from IndexedDB:', err);
    }

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

              {/* Verifying - Sender (scanned QR code) shows verification code display */}
              {/* Only show verification code on sender side when there's a session ID (scanning device) */}
              {connectionState === "verifying" && verificationCode && searchParams?.get("session") && (
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

              {/* Verifying - Receiver (generated QR code) shows verification input */}
              {/* Show verification input on receiver side when there's no session ID */}
              {connectionState === "verifying" && !searchParams?.get("session") && (
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

            {/* Connection Logs - Desktop */}
            <div className="mt-6 hidden lg:block">
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
                  onPaste={(e) => handlePasteFromClipboard(e)}
                  placeholder={t("clipboard.textPlaceholder")}
                  className="w-full h-32 p-3 border-none resize-none focus:outline-none focus:ring-0"
                />
                  <div className="flex justify-between items-center mt-2">
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handlePasteFromClipboard()}
                        className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                      >
                        {t("clipboard.pasteTextHere")}
                      </button>
                      {textContent && (
                        <button
                          onClick={handleClearText}
                          className="text-sm text-red-600 hover:text-red-700 font-medium"
                        >
                          {t("clipboard.clearText")}
                        </button>
                      )}
                    </div>
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
                      <ClipboardHistoryItemComponent
                        key={item.id}
                        item={item}
                        connectionState={connectionState}
                        onDelete={handleDeleteItem}
                        onSend={handleSendItem}
                        t={t}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Connection Logs - Mobile */}
        <div className="mt-6 lg:hidden">
          <ConnectionLogger logs={logs} maxHeight="300px" />
        </div>

        <BuyMeACoffee language={lang === "zh" ? "zh-TW" : "en"} />
      </main>
    </div>
  );
}