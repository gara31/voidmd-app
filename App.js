/**
 * VoidMD Mobile App — React Native
 * 
 * Setup:
 *   npx create-expo-app VoidMDApp --template blank
 *   cd VoidMDApp
 *   npx expo install expo-notifications
 *   npm install @react-navigation/native @react-navigation/bottom-tabs
 *   npx expo install react-native-screens react-native-safe-area-context
 *   npm install react-native-vector-icons
 * 
 * Lalu ganti isi App.js dengan file ini.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, StatusBar, ActivityIndicator, Alert,
  Switch, ScrollView, RefreshControl, Platform,
  KeyboardAvoidingView, Animated,
} from "react-native";
import { SafeAreaView, SafeAreaProvider } from "react-native-safe-area-context";

// ─── CONFIG ─────────────────────────────────────────────────────────────────
// Ganti dengan IP server kamu saat development, atau domain production
const API_BASE = "http://192.168.1.100:3001"; // Ganti ini!
const WS_BASE  = "ws://192.168.1.100:3001";   // Ganti ini!
const API_TOKEN = "voidmd-secret";             // Samakan dengan config.json bot

// ─── Theme ──────────────────────────────────────────────────────────────────
const C = {
  bg      : "#0D0D0F",
  surface : "#18181B",
  border  : "#27272A",
  accent  : "#22C55E",
  accentDim:"#16A34A",
  danger  : "#EF4444",
  warn    : "#F59E0B",
  text    : "#FAFAFA",
  textMid : "#A1A1AA",
  textDim : "#52525B",
  white   : "#FFFFFF",
};

// ─── API Helper ──────────────────────────────────────────────────────────────
const api = async (path, method = "GET", body = null) => {
  const opts = {
    method,
    headers: { "Content-Type": "application/json", "x-api-key": API_TOKEN },
  };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(`${API_BASE}${path}`, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

// ══════════════════════════════════════════════════════════════════════════════
// SCREENS
// ══════════════════════════════════════════════════════════════════════════════

// ─── Screen: Dashboard ───────────────────────────────────────────────────────
function DashboardScreen() {
  const [status, setStatus]     = useState(null);
  const [loading, setLoading]   = useState(true);
  const [refresh, setRefresh]   = useState(false);
  const dotAnim                 = useRef(new Animated.Value(1)).current;

  const pulse = () => {
    Animated.sequence([
      Animated.timing(dotAnim, { toValue: 0.2, duration: 600, useNativeDriver: true }),
      Animated.timing(dotAnim, { toValue: 1,   duration: 600, useNativeDriver: true }),
    ]).start(pulse);
  };

  useEffect(() => { pulse(); }, []);

  const load = useCallback(async () => {
    try {
      const data = await api("/api/status");
      setStatus(data);
    } catch (e) {
      setStatus(null);
    } finally {
      setLoading(false);
      setRefresh(false);
    }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);

  if (loading) return <Loader />;

  const connected = status?.connected;

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={{ padding: 20 }}
      refreshControl={<RefreshControl refreshing={refresh} onRefresh={() => { setRefresh(true); load(); }} tintColor={C.accent} />}
    >
      {/* Status Card */}
      <View style={[s.card, { borderColor: connected ? C.accent : C.danger }]}>
        <View style={s.row}>
          <Animated.View style={[s.dot, { backgroundColor: connected ? C.accent : C.danger, opacity: dotAnim }]} />
          <Text style={s.cardTitle}>{connected ? "Bot Terhubung" : "Bot Tidak Aktif"}</Text>
        </View>
        {connected && (
          <>
            <Text style={s.cardBig}>{status.botName || "Void-MD"}</Text>
            <Text style={s.cardSub}>📱 {status.botPhone}</Text>
          </>
        )}
        {!connected && (
          <Text style={s.cardSub}>Bot tidak aktif. Jalankan bot di server dulu.</Text>
        )}
      </View>

      {/* Stats */}
      {status && (
        <>
          <Text style={s.sectionTitle}>Statistik</Text>
          <View style={s.grid}>
            <StatCard label="Uptime"    value={formatUptime(status.uptime)} icon="⏱" />
            <StatCard label="RAM Used"  value={status.ram?.used || "-"}     icon="💾" />
            <StatCard label="Total Msg" value={status.totalMessages || "0"} icon="💬" />
            <StatCard label="PID"       value={String(status.pid || "-")}   icon="⚙️" />
          </View>
        </>
      )}
    </ScrollView>
  );
}

// ─── Screen: Pesan ───────────────────────────────────────────────────────────
function MessagesScreen() {
  const [messages, setMessages] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [refresh,  setRefresh]  = useState(false);
  const wsRef                   = useRef(null);

  const loadMessages = useCallback(async () => {
    try {
      const data = await api("/api/messages?limit=100");
      setMessages(data.messages || []);
    } catch {}
    setLoading(false);
    setRefresh(false);
  }, []);

  useEffect(() => {
    loadMessages();

    // WebSocket real-time
    const ws = new WebSocket(`${WS_BASE}?token=${API_TOKEN}`);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.type === "message") {
          setMessages(prev => [ev.data, ...prev].slice(0, 100));
        }
      } catch {}
    };

    return () => ws.close();
  }, []);

  if (loading) return <Loader />;

  return (
    <View style={s.screen}>
      <FlatList
        data={messages}
        keyExtractor={(item, i) => item.id || String(i)}
        renderItem={({ item }) => <MsgItem msg={item} />}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={
          <RefreshControl refreshing={refresh} onRefresh={() => { setRefresh(true); loadMessages(); }} tintColor={C.accent} />
        }
        ListEmptyComponent={<Empty text="Belum ada pesan masuk" />}
      />
    </View>
  );
}

// ─── Screen: Kirim Pesan ─────────────────────────────────────────────────────
function SendScreen() {
  const [to,      setTo]      = useState("");
  const [text,    setText]    = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    const num = to.trim();
    const msg = text.trim();
    if (!num || !msg) return Alert.alert("Isi dulu", "Nomor dan pesan harus diisi.");

    setSending(true);
    try {
      await api("/api/send", "POST", { to: num, text: msg });
      Alert.alert("✅ Terkirim", `Pesan berhasil dikirim ke ${num}`);
      setText("");
    } catch (e) {
      Alert.alert("❌ Gagal", e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={s.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text style={s.sectionTitle}>Kirim Pesan via Bot</Text>

        <Text style={s.label}>Nomor Tujuan</Text>
        <TextInput
          style={s.input}
          placeholder="628xxxxxxxxxx"
          placeholderTextColor={C.textDim}
          value={to}
          onChangeText={setTo}
          keyboardType="phone-pad"
        />

        <Text style={s.label}>Pesan</Text>
        <TextInput
          style={[s.input, { height: 120, textAlignVertical: "top" }]}
          placeholder="Tulis pesan di sini..."
          placeholderTextColor={C.textDim}
          value={text}
          onChangeText={setText}
          multiline
        />

        <TouchableOpacity style={[s.btn, sending && s.btnDisabled]} onPress={send} disabled={sending}>
          {sending
            ? <ActivityIndicator color={C.white} />
            : <Text style={s.btnText}>📤 Kirim Sekarang</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Screen: Settings ────────────────────────────────────────────────────────
function SettingsScreen() {
  const [config,   setConfig]   = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [prefix,   setPrefix]   = useState(".");
  const [botname,  setBotname]  = useState("");
  const [publicMode, setPublic] = useState("onlygc");

  useEffect(() => {
    api("/api/config").then(data => {
      setConfig(data);
      setPrefix(data.prefix || ".");
      setBotname(data.botname || "");
      setPublic(data.cfg?.public || "onlygc");
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api("/api/config", "POST", {
        prefix,
        botname,
        cfg: { ...config?.cfg, public: publicMode },
      });
      Alert.alert("✅ Tersimpan", "Konfigurasi berhasil diupdate!");
    } catch (e) {
      Alert.alert("❌ Gagal", e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loader />;

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 20 }}>
      <Text style={s.sectionTitle}>Konfigurasi Bot</Text>

      <Text style={s.label}>Nama Bot</Text>
      <TextInput style={s.input} value={botname} onChangeText={setBotname} placeholderTextColor={C.textDim} />

      <Text style={s.label}>Prefix Command</Text>
      <TextInput style={s.input} value={prefix} onChangeText={setPrefix} placeholderTextColor={C.textDim} maxLength={3} />

      <Text style={s.label}>Mode Bot</Text>
      <View style={s.toggleRow}>
        {["public", "onlygc", "self"].map(m => (
          <TouchableOpacity
            key={m}
            style={[s.chip, publicMode === m && s.chipActive]}
            onPress={() => setPublic(m)}
          >
            <Text style={[s.chipText, publicMode === m && s.chipTextActive]}>{m}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={{ height: 20 }} />

      {/* Toggle Settings */}
      <ToggleRow label="Self Mode"  value={config?.cfg?.selfMode}  onChange={v => setConfig(c => ({ ...c, cfg: { ...c.cfg, selfMode: v } }))} />
      <ToggleRow label="Auto Read"  value={config?.cfg?.autoRead}  onChange={v => setConfig(c => ({ ...c, cfg: { ...c.cfg, autoRead: v } }))} />
      <ToggleRow label="Anti Call"  value={config?.cfg?.antiCall}  onChange={v => setConfig(c => ({ ...c, cfg: { ...c.cfg, antiCall: v } }))} />

      <TouchableOpacity style={[s.btn, saving && s.btnDisabled]} onPress={save} disabled={saving}>
        {saving
          ? <ActivityIndicator color={C.white} />
          : <Text style={s.btnText}>💾 Simpan Perubahan</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Screen: Commands ─────────────────────────────────────────────────────────
function CommandsScreen() {
  const [cmds,    setCmds]   = useState({});
  const [loading, setLoading] = useState(true);
  const [search,  setSearch] = useState("");

  useEffect(() => {
    api("/api/commands").then(d => { setCmds(d.commands || {}); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <Loader />;

  const allTags    = Object.keys(cmds);
  const filtered   = {};
  for (const tag of allTags) {
    const f = cmds[tag].filter(c =>
      c.cmd.toLowerCase().includes(search.toLowerCase()) ||
      (c.desc || "").toLowerCase().includes(search.toLowerCase())
    );
    if (f.length > 0) filtered[tag] = f;
  }

  return (
    <View style={s.screen}>
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <TextInput
          style={s.input}
          placeholder="🔍 Cari command..."
          placeholderTextColor={C.textDim}
          value={search}
          onChangeText={setSearch}
        />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}>
        {Object.entries(filtered).map(([tag, list]) => (
          <View key={tag}>
            <Text style={s.tagTitle}>{tag.toUpperCase()}</Text>
            {list.map(cmd => (
              <View key={cmd.cmd} style={s.cmdItem}>
                <Text style={s.cmdName}>{global.prefix || "."}{cmd.cmd}</Text>
                {cmd.desc ? <Text style={s.cmdDesc}>{cmd.desc}</Text> : null}
              </View>
            ))}
          </View>
        ))}
        {Object.keys(filtered).length === 0 && <Empty text="Command tidak ditemukan" />}
      </ScrollView>
    </View>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPONENTS
// ══════════════════════════════════════════════════════════════════════════════

const Loader = () => (
  <View style={s.center}>
    <ActivityIndicator size="large" color={C.accent} />
  </View>
);

const Empty = ({ text }) => (
  <View style={s.center}>
    <Text style={s.textDim}>{text}</Text>
  </View>
);

const StatCard = ({ label, value, icon }) => (
  <View style={s.statCard}>
    <Text style={{ fontSize: 22 }}>{icon}</Text>
    <Text style={s.statVal}>{value}</Text>
    <Text style={s.statLabel}>{label}</Text>
  </View>
);

const MsgItem = ({ msg }) => (
  <View style={s.msgItem}>
    <View style={s.row}>
      <View style={[s.msgBadge, msg.isGroup && { backgroundColor: "#1D4ED8" }]}>
        <Text style={s.msgBadgeText}>{msg.isGroup ? "GC" : "PM"}</Text>
      </View>
      <Text style={s.msgFrom}>{msg.fromName || msg.from || "?"}</Text>
      <Text style={s.msgTime}>{msg.time ? new Date(msg.time).toLocaleTimeString("id-ID") : ""}</Text>
    </View>
    <Text style={s.msgText} numberOfLines={2}>{msg.text || `[${msg.type || "media"}]`}</Text>
  </View>
);

const ToggleRow = ({ label, value, onChange }) => (
  <View style={[s.row, { justifyContent: "space-between", marginBottom: 16 }]}>
    <Text style={s.text}>{label}</Text>
    <Switch
      value={!!value}
      onValueChange={onChange}
      trackColor={{ false: C.border, true: C.accentDim }}
      thumbColor={value ? C.accent : C.textDim}
    />
  </View>
);

// ══════════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════════════════════

const TABS = [
  { key: "dashboard", label: "Home",     icon: "🏠", Screen: DashboardScreen },
  { key: "messages",  label: "Pesan",    icon: "💬", Screen: MessagesScreen  },
  { key: "send",      label: "Kirim",    icon: "📤", Screen: SendScreen      },
  { key: "commands",  label: "Command",  icon: "⌨️", Screen: CommandsScreen  },
  { key: "settings",  label: "Setelan",  icon: "⚙️", Screen: SettingsScreen  },
];

export default function App() {
  const [active, setActive] = useState("dashboard");
  const { Screen } = TABS.find(t => t.key === active);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.headerTitle}>🤖 Void-MD</Text>
          <View style={s.headerDot} />
        </View>

        {/* Screen */}
        <View style={{ flex: 1 }}>
          <Screen />
        </View>

        {/* Bottom Tab */}
        <View style={s.tabBar}>
          {TABS.map(tab => (
            <TouchableOpacity
              key={tab.key}
              style={s.tabItem}
              onPress={() => setActive(tab.key)}
            >
              <Text style={{ fontSize: 20 }}>{tab.icon}</Text>
              <Text style={[s.tabLabel, active === tab.key && s.tabLabelActive]}>
                {tab.label}
              </Text>
              {active === tab.key && <View style={s.tabIndicator} />}
            </TouchableOpacity>
          ))}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

// ─── Utils ───────────────────────────────────────────────────────────────────
function formatUptime(secs) {
  if (!secs) return "-";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return `${h}j ${m}m ${s}d`;
}

// ══════════════════════════════════════════════════════════════════════════════
// STYLES
// ══════════════════════════════════════════════════════════════════════════════
const s = StyleSheet.create({
  screen     : { flex: 1, backgroundColor: C.bg },
  center     : { flex: 1, justifyContent: "center", alignItems: "center", padding: 40 },
  row        : { flexDirection: "row", alignItems: "center" },

  // Header
  header     : { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                  paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderColor: C.border },
  headerTitle: { color: C.text, fontSize: 18, fontWeight: "700", letterSpacing: 0.5 },
  headerDot  : { width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent },

  // Tab
  tabBar      : { flexDirection: "row", backgroundColor: C.surface, borderTopWidth: 1, borderColor: C.border,
                   paddingBottom: Platform.OS === "ios" ? 20 : 8, paddingTop: 8 },
  tabItem     : { flex: 1, alignItems: "center", gap: 2 },
  tabLabel    : { color: C.textDim, fontSize: 10 },
  tabLabelActive: { color: C.accent },
  tabIndicator: { position: "absolute", bottom: -8, width: 24, height: 2, borderRadius: 1, backgroundColor: C.accent },

  // Cards
  card       : { backgroundColor: C.surface, borderRadius: 16, padding: 20, marginBottom: 16,
                  borderWidth: 1 },
  cardTitle  : { color: C.text, fontSize: 16, fontWeight: "600", marginLeft: 10 },
  cardBig    : { color: C.white, fontSize: 22, fontWeight: "800", marginTop: 8 },
  cardSub    : { color: C.textMid, fontSize: 13, marginTop: 4 },

  // Grid stats
  grid       : { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  statCard   : { backgroundColor: C.surface, borderRadius: 14, padding: 16, flex: 1,
                  minWidth: "45%", alignItems: "center", borderWidth: 1, borderColor: C.border },
  statVal    : { color: C.white, fontSize: 18, fontWeight: "700", marginTop: 6 },
  statLabel  : { color: C.textDim, fontSize: 11, marginTop: 2 },

  // Messages
  msgItem    : { backgroundColor: C.surface, borderRadius: 12, padding: 14, marginBottom: 10,
                  borderWidth: 1, borderColor: C.border },
  msgBadge   : { backgroundColor: C.accentDim, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  msgBadgeText:{ color: C.white, fontSize: 10, fontWeight: "700" },
  msgFrom    : { color: C.text, fontSize: 13, fontWeight: "600", marginLeft: 8, flex: 1 },
  msgTime    : { color: C.textDim, fontSize: 11 },
  msgText    : { color: C.textMid, fontSize: 13, marginTop: 6 },

  // Form
  label      : { color: C.textMid, fontSize: 13, marginBottom: 8, marginTop: 16 },
  input      : { backgroundColor: C.surface, borderRadius: 12, padding: 14, color: C.text,
                  fontSize: 15, borderWidth: 1, borderColor: C.border },
  btn        : { backgroundColor: C.accent, borderRadius: 14, padding: 16, alignItems: "center", marginTop: 24 },
  btnDisabled: { opacity: 0.6 },
  btnText    : { color: C.white, fontSize: 16, fontWeight: "700" },

  // Toggles
  toggleRow  : { flexDirection: "row", gap: 10 },
  chip       : { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1,
                  borderColor: C.border, alignItems: "center" },
  chipActive : { backgroundColor: C.accent, borderColor: C.accent },
  chipText   : { color: C.textMid, fontSize: 13 },
  chipTextActive: { color: C.white, fontWeight: "700" },

  // Commands
  sectionTitle: { color: C.text, fontSize: 18, fontWeight: "700", marginBottom: 16, marginTop: 8 },
  tagTitle    : { color: C.accent, fontSize: 12, fontWeight: "700", letterSpacing: 1.5,
                   marginTop: 20, marginBottom: 8 },
  cmdItem     : { backgroundColor: C.surface, borderRadius: 10, padding: 12, marginBottom: 8,
                   borderWidth: 1, borderColor: C.border },
  cmdName     : { color: C.white, fontSize: 14, fontWeight: "600" },
  cmdDesc     : { color: C.textMid, fontSize: 12, marginTop: 3 },

  // Dot
  dot        : { width: 10, height: 10, borderRadius: 5 },

  text       : { color: C.text, fontSize: 15 },
  textDim    : { color: C.textDim, fontSize: 14 },
});
