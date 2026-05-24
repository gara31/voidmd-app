/**
 * VoidMD Chat App v2
 * UI seperti WhatsApp — ketik command, bot balas
 *
 * Install:
 *   npx create-expo-app VoidMDApp --template blank
 *   cd VoidMDApp
 *   npm install react-native-safe-area-context react-native-screens
 *   npx expo install @react-native-async-storage/async-storage expo-av expo-image-picker
 *   Ganti App.js dengan file ini
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, StatusBar, ActivityIndicator, Alert,
  ScrollView, Platform, KeyboardAvoidingView,
  Image, Pressable, Animated, Dimensions,
} from "react-native";
import { SafeAreaView, SafeAreaProvider } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";

const { width: SW } = Dimensions.get("window");

// ─── Theme ────────────────────────────────────────────────────────────────────
const C = {
  bg        : "#0B141A",
  surface   : "#1F2C34",
  bubble_bot: "#1F2C34",
  bubble_usr: "#005C4B",
  header    : "#1F2C34",
  input_bg  : "#2A3942",
  border    : "#2A3942",
  accent    : "#00A884",
  text      : "#E9EDEF",
  textMid   : "#8696A0",
  textDim   : "#546E7A",
  white     : "#FFFFFF",
  danger    : "#EF4444",
  time      : "#8696A0",
};

// ─── Storage ──────────────────────────────────────────────────────────────────
const CFG_KEY  = "@voidmd_cfg";
let SERVER = { ip: "", token: "voidmd-secret" };

const loadCfg = async () => {
  try {
    const v = await AsyncStorage.getItem(CFG_KEY);
    if (v) SERVER = JSON.parse(v);
  } catch {}
};

const saveCfg = async () => {
  try { await AsyncStorage.setItem(CFG_KEY, JSON.stringify(SERVER)); } catch {}
};

// ─── API ──────────────────────────────────────────────────────────────────────
const apiUrl = (p) => `http://${SERVER.ip}:3001${p}`;
const wsUrl  = ()  => `ws://${SERVER.ip}:3001?token=${SERVER.token}`;

const apiFetch = async (path, method = "GET", body = null) => {
  const r = await fetch(apiUrl(path), {
    method,
    headers: { "Content-Type": "application/json", "x-api-key": SERVER.token },
    body   : body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

// ─── Session ID unik per device ───────────────────────────────────────────────
let SESSION_ID = null;
const getSessionId = async () => {
  if (SESSION_ID) return SESSION_ID;
  let id = await AsyncStorage.getItem("@voidmd_session");
  if (!id) { id = `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`; await AsyncStorage.setItem("@voidmd_session", id); }
  SESSION_ID = id;
  return id;
};

// ══════════════════════════════════════════════════════════════════════════════
// CHAT SCREEN
// ══════════════════════════════════════════════════════════════════════════════
function ChatScreen({ onOpenSettings }) {
  const [messages, setMessages]   = useState([]);
  const [input,    setInput]      = useState("");
  const [sending,  setSending]    = useState(false);
  const [botOnline,setBotOnline]  = useState(false);
  const [botName,  setBotName]    = useState("Void-MD");
  const [sessionId,setSessionId]  = useState(null);
  const listRef = useRef(null);
  const wsRef   = useRef(null);
  const typingAnim = useRef(new Animated.Value(0)).current;

  // Typing indicator animation
  const showTyping = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(typingAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(typingAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
      ])
    ).start();
  };

  useEffect(() => {
    const init = async () => {
      const sid = await getSessionId();
      setSessionId(sid);

      if (!SERVER.ip) return;

      // Cek status bot
      try {
        const s = await apiFetch("/api/status");
        setBotOnline(s.connected);
        if (s.botName) setBotName(s.botName);
      } catch {}

      // Load history
      try {
        const h = await apiFetch(`/api/chat/history?sessionId=${sid}&limit=100`);
        if (h.messages?.length > 0) setMessages(h.messages);
        else {
          // Welcome message
          setMessages([{
            id  : "welcome",
            role: "bot",
            time: Date.now(),
            type: "text",
            text: `👋 Halo! Selamat datang di *${botName}*\n\nKetik *.menu* untuk melihat semua command yang tersedia.`,
          }]);
        }
      } catch {}

      // WebSocket
      connectWS(sid);
    };
    init();
    return () => wsRef.current?.close();
  }, []);

  const connectWS = (sid) => {
    if (!SERVER.ip) return;
    try {
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;
      ws.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          if (ev.type === "bot_reply" && ev.sessionId === sid) {
            setMessages(prev => [...prev, ev.data]);
            setSending(false);
          }
        } catch {}
      };
      ws.onclose = () => setTimeout(() => connectWS(sid), 3000);
    } catch {}
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending || !sessionId) return;
    if (!SERVER.ip) { Alert.alert("Server belum dikonfigurasi", "Buka Setelan dulu."); return; }

    const userMsg = { id: `u_${Date.now()}`, role: "user", time: Date.now(), type: "text", text };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setSending(true);
    showTyping();

    try {
      const res = await apiFetch("/api/chat/send", "POST", { message: text, sessionId });
      // Kalau WebSocket tidak konek, pakai response langsung
      if (res.replies?.length > 0) {
        setMessages(prev => {
          // Hindari duplikat jika WS sudah push
          const ids = new Set(prev.map(m => m.id));
          const newReplies = res.replies.filter(r => !ids.has(r.id));
          return [...prev, ...newReplies];
        });
      }
    } catch (e) {
      const errMsg = { id: `e_${Date.now()}`, role: "bot", time: Date.now(), type: "text", text: `❌ Gagal: ${e.message}` };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setSending(false);
    }
  };

  // Auto scroll ke bawah
  useEffect(() => {
    if (messages.length > 0) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages]);

  const renderMsg = ({ item }) => {
    const isUser = item.role === "user";
    return (
      <View style={[s.msgRow, isUser ? s.msgRowUser : s.msgRowBot]}>
        <View style={[s.bubble, isUser ? s.bubbleUser : s.bubbleBot]}>
          {/* Text */}
          {(item.type === "text" || !item.type) && item.text ? (
            <Text style={s.bubbleText}>{formatText(item.text)}</Text>
          ) : null}

          {/* Image */}
          {item.type === "image" && item.media ? (
            <View>
              <Image source={{ uri: item.media }} style={s.mediaImg} resizeMode="cover" />
              {item.caption ? <Text style={[s.bubbleText, { marginTop: 6 }]}>{item.caption}</Text> : null}
            </View>
          ) : null}

          {/* Audio */}
          {item.type === "audio" ? (
            <View style={s.audioBox}>
              <Text style={{ fontSize: 24 }}>🎵</Text>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={s.bubbleText}>{item.ptt ? "Voice Note" : "Audio"}</Text>
                <Text style={s.timeText}>Tap untuk mainkan di pemutar musik</Text>
              </View>
            </View>
          ) : null}

          {/* Video */}
          {item.type === "video" ? (
            <View style={s.audioBox}>
              <Text style={{ fontSize: 24 }}>🎬</Text>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={s.bubbleText}>Video</Text>
                {item.caption ? <Text style={s.timeText}>{item.caption}</Text> : null}
              </View>
            </View>
          ) : null}

          {/* Sticker */}
          {item.type === "sticker" && item.media ? (
            <Image source={{ uri: item.media }} style={s.stickerImg} resizeMode="contain" />
          ) : null}

          {/* Document */}
          {item.type === "document" ? (
            <View style={s.audioBox}>
              <Text style={{ fontSize: 24 }}>📄</Text>
              <Text style={[s.bubbleText, { marginLeft: 10 }]}>{item.fileName || "File"}</Text>
            </View>
          ) : null}

          <Text style={s.timeText}>{formatTime(item.time)}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View style={s.chatHeader}>
        <View style={[s.avatar, { backgroundColor: C.accent }]}>
          <Text style={{ color: C.white, fontWeight: "800", fontSize: 16 }}>V</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={s.chatHeaderName}>{botName}</Text>
          <Text style={[s.chatHeaderSub, { color: botOnline ? C.accent : C.textDim }]}>
            {botOnline ? "● Online" : "● Offline"}
          </Text>
        </View>
        <TouchableOpacity onPress={onOpenSettings} style={s.headerBtn}>
          <Text style={{ fontSize: 20 }}>⚙️</Text>
        </TouchableOpacity>
      </View>

      {/* Messages */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={item => item.id}
          renderItem={renderMsg}
          contentContainerStyle={{ padding: 12, paddingBottom: 8 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />

        {/* Typing indicator */}
        {sending && (
          <View style={[s.msgRow, s.msgRowBot]}>
            <View style={[s.bubble, s.bubbleBot, { paddingVertical: 12 }]}>
              <Animated.Text style={[s.bubbleText, { opacity: typingAnim }]}>
                ● ● ●
              </Animated.Text>
            </View>
          </View>
        )}

        {/* Input Bar */}
        <View style={s.inputBar}>
          <TextInput
            style={s.inputField}
            placeholder="Ketik pesan..."
            placeholderTextColor={C.textDim}
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={1000}
            onSubmitEditing={send}
          />
          <TouchableOpacity
            style={[s.sendBtn, (!input.trim() || sending) && s.sendBtnDisabled]}
            onPress={send}
            disabled={!input.trim() || sending}
          >
            {sending
              ? <ActivityIndicator size="small" color={C.white} />
              : <Text style={{ fontSize: 20 }}>➤</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SETTINGS SCREEN
// ══════════════════════════════════════════════════════════════════════════════
function SettingsScreen({ onBack }) {
  const [ip,      setIp]      = useState(SERVER.ip);
  const [token,   setToken]   = useState(SERVER.token);
  const [status,  setStatus]  = useState(null);
  const [testing, setTesting] = useState(false);
  const [saving,  setSaving]  = useState(false);

  const test = async () => {
    if (!ip) return Alert.alert("IP kosong", "Masukkan IP server dulu.");
    setTesting(true);
    setStatus(null);
    SERVER = { ip, token };
    try {
      const d = await apiFetch("/api/status");
      setStatus(d.connected
        ? `✅ Terhubung! Bot aktif — ${d.botName || "Void-MD"}`
        : "⚠️ Server aktif tapi bot belum jalan");
    } catch {
      setStatus("❌ Gagal konek. Cek IP dan token.");
      SERVER = { ip: "", token };
    } finally { setTesting(false); }
  };

  const save = async () => {
    if (!ip) return Alert.alert("IP kosong", "Masukkan IP dulu.");
    setSaving(true);
    SERVER = { ip, token };
    await saveCfg();
    setSaving(false);
    Alert.alert("✅ Tersimpan", "Konfigurasi berhasil disimpan!");
    onBack();
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={s.chatHeader}>
        <TouchableOpacity onPress={onBack} style={s.headerBtn}>
          <Text style={{ fontSize: 22, color: C.text }}>←</Text>
        </TouchableOpacity>
        <Text style={[s.chatHeaderName, { marginLeft: 12 }]}>Konfigurasi Server</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <View style={s.infoBox}>
          <Text style={s.infoText}>💡 Ganti VPS? Cukup ubah IP di sini, tidak perlu rebuild APK!</Text>
        </View>

        <Text style={s.label}>IP Server / VPS</Text>
        <TextInput style={s.input} placeholder="38.45.65.8" placeholderTextColor={C.textDim} value={ip} onChangeText={setIp} keyboardType="numeric" />

        <Text style={s.label}>API Token</Text>
        <TextInput style={s.input} placeholder="voidmd-secret" placeholderTextColor={C.textDim} value={token} onChangeText={setToken} autoCapitalize="none" />

        {status && (
          <View style={[s.statusBox, {
            borderColor: status.startsWith("✅") ? C.accent : status.startsWith("⚠️") ? "#F59E0B" : C.danger
          }]}>
            <Text style={{ color: C.text }}>{status}</Text>
          </View>
        )}

        <TouchableOpacity style={[s.btnOutline, testing && { opacity: 0.6 }]} onPress={test} disabled={testing}>
          {testing ? <ActivityIndicator color={C.accent} /> : <Text style={s.btnOutlineText}>🔌 Test Koneksi</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={[s.btn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
          {saving ? <ActivityIndicator color={C.white} /> : <Text style={s.btnText}>💾 Simpan & Mulai Chat</Text>}
        </TouchableOpacity>

        <View style={{ height: 40 }} />
        <Text style={[s.label, { textAlign: "center", color: C.textDim }]}>Void-MD Chat v2.0</Text>
        <Text style={[s.label, { textAlign: "center", color: C.textDim, fontSize: 11 }]}>
          Aplikasi ini terhubung ke bot WhatsApp kamu.{"\n"}Bot harus aktif dan api-server.js terpasang.
        </Text>
      </ScrollView>
    </View>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// APP ROOT
// ══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [screen, setScreen] = useState("loading");

  useEffect(() => {
    loadCfg().then(() => {
      setScreen(SERVER.ip ? "chat" : "settings");
    });
  }, []);

  if (screen === "loading") return (
    <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: "center", alignItems: "center" }}>
      <ActivityIndicator size="large" color={C.accent} />
    </View>
  );

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={C.header} />
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
        {screen === "chat"
          ? <ChatScreen     onOpenSettings={() => setScreen("settings")} />
          : <SettingsScreen onBack={() => setScreen("chat")} />}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function formatTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

function formatText(text) {
  // Bold *text* → tampil normal, React Native tidak support inline bold di Text biasa
  return text.replace(/\*/g, "").replace(/_/g, "");
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  // Header
  chatHeader   : { flexDirection: "row", alignItems: "center", backgroundColor: C.header, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border },
  chatHeaderName: { color: C.text, fontSize: 17, fontWeight: "700" },
  chatHeaderSub: { fontSize: 12, marginTop: 1 },
  avatar       : { width: 40, height: 40, borderRadius: 20, justifyContent: "center", alignItems: "center" },
  headerBtn    : { padding: 6 },

  // Bubbles
  msgRow       : { marginVertical: 2, flexDirection: "row" },
  msgRowUser   : { justifyContent: "flex-end" },
  msgRowBot    : { justifyContent: "flex-start" },
  bubble       : { maxWidth: SW * 0.78, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, paddingBottom: 4 },
  bubbleUser   : { backgroundColor: C.bubble_usr, borderTopRightRadius: 0 },
  bubbleBot    : { backgroundColor: C.bubble_bot, borderTopLeftRadius: 0 },
  bubbleText   : { color: C.text, fontSize: 15, lineHeight: 21 },
  timeText     : { color: C.time, fontSize: 11, textAlign: "right", marginTop: 4 },

  // Media
  mediaImg     : { width: SW * 0.65, height: SW * 0.5, borderRadius: 6, marginBottom: 4 },
  stickerImg   : { width: 120, height: 120 },
  audioBox     : { flexDirection: "row", alignItems: "center", paddingVertical: 4 },

  // Input
  inputBar     : { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 8, paddingVertical: 8, backgroundColor: C.header, gap: 8 },
  inputField   : { flex: 1, backgroundColor: C.input_bg, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 10, color: C.text, fontSize: 15, maxHeight: 120 },
  sendBtn      : { width: 44, height: 44, borderRadius: 22, backgroundColor: C.accent, justifyContent: "center", alignItems: "center" },
  sendBtnDisabled: { backgroundColor: C.textDim },

  // Settings
  label        : { color: C.textMid, fontSize: 13, marginBottom: 8, marginTop: 16 },
  input        : { backgroundColor: C.surface, borderRadius: 10, padding: 14, color: C.text, fontSize: 15, borderWidth: 1, borderColor: C.border },
  btn          : { backgroundColor: C.accent, borderRadius: 12, padding: 16, alignItems: "center", marginTop: 16 },
  btnOutline   : { borderWidth: 1.5, borderColor: C.accent, borderRadius: 12, padding: 16, alignItems: "center", marginTop: 16 },
  btnOutlineText: { color: C.accent, fontSize: 15, fontWeight: "700" },
  btnText      : { color: C.white, fontSize: 15, fontWeight: "700" },
  infoBox      : { backgroundColor: "#0d2118", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.accent },
  infoText     : { color: C.accent, fontSize: 13 },
  statusBox    : { borderRadius: 10, padding: 12, marginTop: 14, borderWidth: 1 },
});
