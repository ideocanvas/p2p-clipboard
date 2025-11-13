import js from "@eslint/js";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
  js.configs.recommended,
  {
    // Browser environment for frontend files
    files: ["app/**/*.{js,jsx,ts,tsx}", "components/**/*.{js,jsx,ts,tsx}", "hooks/**/*.{js,jsx,ts,tsx}", "lib/**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parser: typescriptParser,
      globals: {
        // Browser globals
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        console: "readonly",
        fetch: "readonly",
        URL: "readonly",
        Blob: "readonly",
        File: "readonly",
        React: "readonly",
        localStorage: "readonly",
        // DOM element types
        HTMLDivElement: "readonly",
        HTMLCanvasElement: "readonly",
        HTMLInputElement: "readonly",
        HTMLParagraphElement: "readonly",
        HTMLHeadingElement: "readonly",
        // WebRTC globals
        RTCPeerConnection: "readonly",
        RTCDataChannel: "readonly",
        RTCSessionDescription: "readonly",
        RTCIceCandidate: "readonly",
        RTCIceServer: "readonly",
        RTCSessionDescriptionInit: "readonly",
        RTCIceCandidateInit: "readonly",
        RTCPeerConnectionState: "readonly",
        RTCIceConnectionState: "readonly",
        RTCSignalingState: "readonly",
        RTCDataChannelState: "readonly",
        // Timer globals
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        // Encoding globals
        atob: "readonly",
        btoa: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        // Node.js types
        NodeJS: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": typescriptEslint,
    },
    rules: {
      ...typescriptEslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/exhaustive-deps": "off",
      "no-case-declarations": "off",
    },
  },
  {
    // Node.js environment for API routes
    files: ["app/api/**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parser: typescriptParser,
      globals: {
        // Node.js globals
        console: "readonly",
        fetch: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        atob: "readonly",
        btoa: "readonly",
        process: "readonly",
        // WebRTC globals (for Cloudflare Workers)
        RTCPeerConnection: "readonly",
        RTCDataChannel: "readonly",
        RTCSessionDescription: "readonly",
        RTCIceCandidate: "readonly",
        RTCIceServer: "readonly",
        RTCSessionDescriptionInit: "readonly",
        RTCIceCandidateInit: "readonly",
        RTCPeerConnectionState: "readonly",
        RTCIceConnectionState: "readonly",
        RTCSignalingState: "readonly",
        RTCDataChannelState: "readonly",
        // Node.js types
        NodeJS: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": typescriptEslint,
    },
    rules: {
      ...typescriptEslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/exhaustive-deps": "off",
      "no-case-declarations": "off",
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },
  {
    ignores: [".next/", "dist/", "node_modules/"],
  },
];

export default eslintConfig;
