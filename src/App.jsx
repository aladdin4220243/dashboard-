import { useState, useEffect, useCallback } from "react";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

// ─── CONFIG ────────────────────────────────────────────────────────────────
const INGESTION_URL = "https://ingestion-production-c968.up.railway.app";
const POLL_INTERVAL = 5000; // ms

// ─── HELPERS ───────────────────────────────────────────────────────────────
const fmt = (ts) => {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleTimeString("en-GB", { hour12: false }); }
  catch { return ts; }
};

const EVENT_COLORS = {
  "cowrie.login.success":    "#10b981",
  "cowrie.login.failed":     "#ef4444",
  "cowrie.command.input":    "#3b82f6",
  "cowrie.session.connect":  "#8b5cf6",
  "cowrie.session.closed":   "#6b7280",
  "cowrie.client.kex":       "#f59e0b",
  "cowrie.client.version":   "#f59e0b",
  "cowrie.session.params":   "#94a3b8",
  "cowrie.client.size":      "#94a3b8",
  "cowrie.log.closed":       "#64748b",
  "authentication_success":  "#10b981",
  "authentication_failed":   "#ef4444",
  "command_input":           "#3b82f6",
  "connection_new":          "#8b5cf6",
  "connection_closed":       "#6b7280",
  "ssh":                     "#8b5cf6",
  "http":                    "#3b82f6",
};

const eventColor = (type) =>
  EVENT_COLORS[type] || EVENT_COLORS[type?.split(".")[0]] || "#94a3b8";

// Build a session map from a flat event list
function buildSessions(events) {
  const map = {};
  events.forEach((e) => {
    const ip = e.src_ip || "unknown";
    const sid = e.session_id || ip;
    if (!map[sid]) {
      map[sid] = {
        id: sid,
        ip,
        protocol: e.protocol || "ssh",
        events: [],
        firstSeen: e.timestamp,
        lastSeen: e.timestamp,
        username: null,
        commands: [],
      };
    }
    map[sid].events.push(e);
    if (e.timestamp > map[sid].lastSeen) map[sid].lastSeen = e.timestamp;
    if (e.username) map[sid].username = e.username;
    if (e.command) map[sid].commands.push(e.command);
  });

  return Object.values(map).map((s) => {
    const hasSuccess = s.events.some((e) =>
      e.event_type?.includes("login.success") ||
      e.event_type?.includes("authentication_success")
    );
    const hasFailed = s.events.some((e) =>
      e.event_type?.includes("login.failed") ||
      e.event_type?.includes("authentication_failed")
    );
    const score = Math.min(5,
      (hasSuccess ? 3 : 0) +
      (s.commands.length > 2 ? 1 : 0) +
      (s.events.length > 10 ? 1 : 0)
    );
    const level = score >= 4 ? 3 : score >= 2 ? 2 : 1;
    return { ...s, score, level, eventCount: s.events.length };
  }).sort((a, b) => b.lastSeen?.localeCompare(a.lastSeen));
}

// Build hourly activity buckets from events
function buildTimeline(events) {
  const buckets = {};
  events.forEach((e) => {
    if (!e.timestamp) return;
    try {
      const d = new Date(e.timestamp);
      const key = `${String(d.getUTCHours()).padStart(2,"0")}:${String(Math.floor(d.getUTCMinutes()/15)*15).padStart(2,"0")}`;
      buckets[key] = (buckets[key] || 0) + 1;
    } catch {}
  });
  return Object.entries(buckets).sort().slice(-12).map(([hour, events]) => ({ hour, events }));
}

// Count event types
function buildTypeCounts(events) {
  const counts = {};
  events.forEach((e) => {
    const t = e.event_type || "unknown";
    counts[t] = (counts[t] || 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([name, count]) => ({ name: name.replace("cowrie.", "").replace(/_/g, " "), full: name, count }));
}

// ─── SCORE DOT ─────────────────────────────────────────────────────────────
function ScoreDot({ score }) {
  const colors = ["#6b7280","#10b981","#f59e0b","#f97316","#ef4444","#dc2626"];
  return (
    <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
      {[0,1,2,3,4,5].map(i => (
        <div key={i} style={{
          width: 7, height: 7, borderRadius: "50%",
          background: i <= score ? colors[Math.min(score,5)] : "#e5e7eb",
          transition: "background 0.3s",
        }} />
      ))}
    </div>
  );
}

const LEVEL_COLORS = { 1: "#10b981", 2: "#f59e0b", 3: "#ef4444" };
const LEVEL_BG    = { 1: "#d1fae5", 2: "#fef3c7", 3: "#fee2e2" };

// ─── STATUS BADGE ───────────────────────────────────────────────────────────
function StatusBadge({ ok, label }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 8px", borderRadius: 20, fontSize: 11,
      background: ok ? "#d1fae5" : "#fee2e2",
      color: ok ? "#065f46" : "#991b1b",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: ok ? "#10b981" : "#ef4444" }} />
      {label}
    </span>
  );
}

// ─── MAIN DASHBOARD ────────────────────────────────────────────────────────
export default function Dashboard() {
  const [page, setPage] = useState("home");
  const [selectedSession, setSelectedSession] = useState(null);
  const [sessionFilter, setSessionFilter] = useState("all");

  // Live data state
  const [events, setEvents]       = useState([]);
  const [health, setHealth]       = useState(null);
  const [queueDepth, setQueueDepth] = useState(0);
  const [loading, setLoading]     = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [error, setError]         = useState(null);

  // Fetch from Ingestion
  const fetchData = useCallback(async () => {
    try {
      // 1. Health check
      const hRes = await fetch(`${INGESTION_URL}/health`);
      const hData = await hRes.json();
      setHealth(hData);

      // 2. Queue depth
      const mRes = await fetch(`${INGESTION_URL}/metrics`);
      const mData = await mRes.json();
      setQueueDepth(mData.queue_depth ?? 0);

      // 3. Events via /api/events (if available)
      try {
        const eRes = await fetch(`${INGESTION_URL}/api/events?limit=200`);
        if (eRes.ok) {
          const eData = await eRes.json();
          if (eData.success && Array.isArray(eData.events)) {
            setEvents(eData.events);
          }
        }
      } catch {
        // /api/events not deployed yet — keep existing events
      }

      setLastUpdate(new Date());
      setError(null);
    } catch (err) {
      setError("Cannot reach Ingestion API");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, POLL_INTERVAL);
    return () => clearInterval(t);
  }, [fetchData]);

  // Derived data
  const sessions      = buildSessions(events);
  const timeline      = buildTimeline(events);
  const typeCounts    = buildTypeCounts(events);
  const activeSessions = sessions.filter(s => {
    if (!s.lastSeen) return false;
    return (Date.now() - new Date(s.lastSeen)) < 5 * 60 * 1000;
  });
  const escalated     = sessions.filter(s => s.level === 3);

  const filteredSessions = sessionFilter === "all"
    ? sessions
    : sessions.filter(s => s.level === parseInt(sessionFilter));

  const navItems = [
    { id: "home",     label: "Overview" },
    { id: "sessions", label: "Sessions" },
    { id: "events",   label: "Events" },
    { id: "metrics",  label: "Metrics" },
  ];

  const redisOk = health?.redis === "up";

  return (
    <div style={{ fontFamily: "'IBM Plex Mono', 'Courier New', monospace", minHeight: "100vh", background: "#f8fafc" }}>

      {/* NAV */}
      <div style={{
        background: "#0f172a", padding: "0 24px",
        display: "flex", alignItems: "center", gap: 32, height: 52,
        borderBottom: "1px solid #1e293b",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="3" fill="#10b981" />
            <circle cx="10" cy="10" r="7" stroke="#10b981" strokeWidth="1" fill="none" opacity="0.4" />
            <circle cx="10" cy="10" r="9.5" stroke="#10b981" strokeWidth="0.5" fill="none" opacity="0.2" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9", letterSpacing: "0.05em" }}>LABYRINTH</span>
        </div>

        <div style={{ display: "flex", gap: 2 }}>
          {navItems.map(n => (
            <button key={n.id} onClick={() => { setPage(n.id); setSelectedSession(null); }}
              style={{
                padding: "6px 14px", borderRadius: 6, fontSize: 12, border: "none",
                cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.04em",
                background: page === n.id ? "#1e293b" : "transparent",
                color: page === n.id ? "#f1f5f9" : "#64748b",
                fontWeight: page === n.id ? 600 : 400,
                transition: "all 0.15s",
              }}>
              {n.label}
            </button>
          ))}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          {lastUpdate && (
            <span style={{ fontSize: 10, color: "#475569", letterSpacing: "0.04em" }}>
              updated {lastUpdate.toLocaleTimeString("en-GB", { hour12: false })}
            </span>
          )}
          <StatusBadge ok={redisOk} label={redisOk ? "redis · up" : "redis · down"} />
          <StatusBadge ok={!error} label={!error ? "ingestion · live" : "ingestion · error"} />
        </div>
      </div>

      {/* BODY */}
      <div style={{ padding: "24px", maxWidth: 1140, margin: "0 auto" }}>

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: "center", padding: 60, color: "#94a3b8", fontSize: 13 }}>
            Connecting to Ingestion API…
          </div>
        )}

        {/* Error banner */}
        {error && !loading && (
          <div style={{
            background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8,
            padding: "12px 16px", marginBottom: 20, fontSize: 12, color: "#991b1b",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            ⚠ {error} — showing last known data. Check that Ingestion service is running.
          </div>
        )}

        {/* ── HOME ── */}
        {!loading && page === "home" && !selectedSession && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 4 }}>
                live threat intelligence
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#0f172a" }}>Overview</div>
            </div>

            {/* STAT CARDS */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
              {[
                { label: "Total events",    value: events.length,          sub: `${queueDepth} in queue` },
                { label: "Sessions",        value: sessions.length,        sub: `${activeSessions.length} active` },
                { label: "Escalated (L3)",  value: escalated.length,       sub: "level 3 sessions" },
                { label: "Redis queue",     value: queueDepth,             sub: redisOk ? "redis up" : "redis down" },
              ].map(card => (
                <div key={card.label} style={{
                  background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10,
                  padding: "16px 18px",
                }}>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6, letterSpacing: "0.06em" }}>{card.label}</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: "#0f172a", lineHeight: 1 }}>{card.value}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 5 }}>{card.sub}</div>
                </div>
              ))}
            </div>

            {/* CHARTS */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 20 }}>
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 14, color: "#0f172a", letterSpacing: "0.04em" }}>
                  EVENT ACTIVITY
                </div>
                {timeline.length > 0 ? (
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={timeline}>
                      <defs>
                        <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="hour" tick={{ fontSize: 9, fontFamily: "inherit" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 9, fontFamily: "inherit" }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ fontSize: 11, fontFamily: "inherit", border: "1px solid #e2e8f0", borderRadius: 6, boxShadow: "none" }} />
                      <Area type="monotone" dataKey="events" stroke="#3b82f6" strokeWidth={2} fill="url(#grad)" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 12 }}>
                    No events yet — send some data to Ingestion
                  </div>
                )}
              </div>

              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 14, color: "#0f172a", letterSpacing: "0.04em" }}>
                  TOP EVENT TYPES
                </div>
                {typeCounts.length > 0 ? (
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={typeCounts} layout="vertical">
                      <XAxis type="number" tick={{ fontSize: 9, fontFamily: "inherit" }} axisLine={false} tickLine={false} />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 9, fontFamily: "inherit" }} axisLine={false} tickLine={false} width={90} />
                      <Tooltip contentStyle={{ fontSize: 11, fontFamily: "inherit", border: "1px solid #e2e8f0", borderRadius: 6, boxShadow: "none" }} />
                      <Bar dataKey="count" fill="#f59e0b" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 12 }}>
                    No data yet
                  </div>
                )}
              </div>
            </div>

            {/* RECENT SESSIONS */}
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 14, color: "#0f172a", letterSpacing: "0.04em" }}>
                RECENT SESSIONS
              </div>
              {sessions.length === 0 ? (
                <div style={{ padding: "24px 0", textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
                  No sessions detected yet. Send events to Ingestion to see them here.
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                      {["IP", "Protocol", "Score", "Level", "Events", "Last seen", ""].map(h => (
                        <th key={h} style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 10, letterSpacing: "0.06em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.slice(0, 10).map(s => (
                      <tr key={s.id} style={{ borderBottom: "1px solid #f8fafc" }}>
                        <td style={{ padding: "10px 10px", fontFamily: "inherit", fontSize: 11, color: "#0f172a" }}>{s.ip}</td>
                        <td style={{ padding: "10px 10px" }}>
                          <span style={{ background: "#f1f5f9", padding: "2px 7px", borderRadius: 4, fontSize: 10, color: "#475569" }}>{s.protocol}</span>
                        </td>
                        <td style={{ padding: "10px 10px" }}><ScoreDot score={s.score} /></td>
                        <td style={{ padding: "10px 10px" }}>
                          <span style={{ background: LEVEL_BG[s.level], color: LEVEL_COLORS[s.level], padding: "2px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700 }}>L{s.level}</span>
                        </td>
                        <td style={{ padding: "10px 10px", color: "#64748b" }}>{s.eventCount}</td>
                        <td style={{ padding: "10px 10px", color: "#94a3b8", fontSize: 11 }}>{fmt(s.lastSeen)}</td>
                        <td style={{ padding: "10px 10px" }}>
                          <button onClick={() => { setSelectedSession(s); setPage("detail"); }}
                            style={{ fontSize: 11, color: "#3b82f6", border: "none", background: "none", cursor: "pointer", fontFamily: "inherit" }}>
                            Detail →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ── SESSIONS ── */}
        {!loading && page === "sessions" && !selectedSession && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a" }}>Sessions</div>
              <div style={{ display: "flex", gap: 4 }}>
                {["all","1","2","3"].map(f => (
                  <button key={f} onClick={() => setSessionFilter(f)}
                    style={{
                      padding: "5px 12px", borderRadius: 6, fontSize: 11, fontFamily: "inherit",
                      border: "1px solid #e2e8f0", cursor: "pointer",
                      background: sessionFilter === f ? "#0f172a" : "#fff",
                      color: sessionFilter === f ? "#f1f5f9" : "#64748b",
                      fontWeight: 500,
                    }}>
                    {f === "all" ? "All" : `L${f}`}
                  </button>
                ))}
              </div>
            </div>

            {filteredSessions.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60, color: "#94a3b8", fontSize: 13 }}>
                No sessions found
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {filteredSessions.map(s => (
                  <div key={s.id}
                    onClick={() => { setSelectedSession(s); setPage("detail"); }}
                    style={{
                      background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10,
                      padding: "14px 18px", display: "flex", alignItems: "center", gap: 16,
                      cursor: "pointer", transition: "border-color 0.15s",
                    }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                      background: (Date.now() - new Date(s.lastSeen)) < 300000 ? "#10b981" : "#d1d5db",
                    }} />
                    <div style={{ fontFamily: "inherit", fontSize: 12, minWidth: 120, color: "#0f172a" }}>{s.ip}</div>
                    <span style={{ background: "#f1f5f9", padding: "2px 7px", borderRadius: 4, fontSize: 10, color: "#475569" }}>{s.protocol}</span>
                    <ScoreDot score={s.score} />
                    <span style={{ background: LEVEL_BG[s.level], color: LEVEL_COLORS[s.level], padding: "2px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700 }}>
                      Level {s.level}
                    </span>
                    {s.username && (
                      <span style={{ fontSize: 11, color: "#475569" }}>user: <b>{s.username}</b></span>
                    )}
                    <div style={{ marginLeft: "auto", fontSize: 11, color: "#94a3b8" }}>
                      {s.eventCount} events · {fmt(s.lastSeen)}
                    </div>
                    <div style={{ fontSize: 11, color: "#3b82f6" }}>View →</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── SESSION DETAIL ── */}
        {!loading && page === "detail" && selectedSession && (
          <div>
            <button onClick={() => { setSelectedSession(null); setPage("sessions"); }}
              style={{ fontSize: 12, color: "#64748b", border: "none", background: "none", cursor: "pointer", padding: 0, marginBottom: 18, fontFamily: "inherit" }}>
              ← Back
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "inherit", color: "#0f172a" }}>{selectedSession.ip}</div>
              <span style={{ background: LEVEL_BG[selectedSession.level], color: LEVEL_COLORS[selectedSession.level], padding: "3px 9px", borderRadius: 5, fontSize: 11, fontWeight: 700 }}>
                Level {selectedSession.level}
              </span>
              <ScoreDot score={selectedSession.score} />
              {selectedSession.username && (
                <span style={{ fontSize: 12, color: "#475569", background: "#f1f5f9", padding: "3px 8px", borderRadius: 5 }}>
                  user: {selectedSession.username}
                </span>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {/* Event timeline */}
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 18, maxHeight: 500, overflowY: "auto" }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 14, color: "#0f172a", letterSpacing: "0.04em" }}>
                  EVENT TIMELINE ({selectedSession.events?.length || 0})
                </div>
                {(selectedSession.events || []).map((e, i) => (
                  <div key={i} style={{ display: "flex", gap: 12, paddingBottom: 12 }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <div style={{ width: 9, height: 9, borderRadius: "50%", background: eventColor(e.event_type), flexShrink: 0, marginTop: 2 }} />
                      {i < selectedSession.events.length - 1 && (
                        <div style={{ width: 1, flex: 1, background: "#f1f5f9", marginTop: 3 }} />
                      )}
                    </div>
                    <div style={{ flex: 1, paddingBottom: 4 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: eventColor(e.event_type) }}>
                          {(e.event_type || "unknown").replace("cowrie.", "").replace(/_/g, " ")}
                        </span>
                        <span style={{ fontSize: 10, color: "#94a3b8" }}>{fmt(e.timestamp)}</span>
                      </div>
                      {(e.username || e.command || e.payload) && (
                        <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>
                          {e.username && <span style={{ color: "#0f172a", fontWeight: 600, marginRight: 6 }}>{e.username}</span>}
                          {e.command || e.payload}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Session info */}
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 14, color: "#0f172a", letterSpacing: "0.04em" }}>
                    SESSION INFO
                  </div>
                  {[
                    ["IP", selectedSession.ip],
                    ["Protocol", selectedSession.protocol],
                    ["Username", selectedSession.username || "—"],
                    ["Events", selectedSession.eventCount],
                    ["First seen", fmt(selectedSession.firstSeen)],
                    ["Last seen", fmt(selectedSession.lastSeen)],
                    ["Commands", selectedSession.commands?.length || 0],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #f8fafc", fontSize: 12 }}>
                      <span style={{ color: "#64748b" }}>{k}</span>
                      <span style={{ color: "#0f172a", fontWeight: 500 }}>{v}</span>
                    </div>
                  ))}
                </div>

                {selectedSession.commands?.length > 0 && (
                  <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: 18 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12, color: "#10b981", letterSpacing: "0.04em" }}>
                      COMMANDS
                    </div>
                    {selectedSession.commands.map((cmd, i) => (
                      <div key={i} style={{ fontSize: 12, color: "#94a3b8", padding: "3px 0", fontFamily: "inherit" }}>
                        <span style={{ color: "#10b981", marginRight: 8 }}>$</span>{cmd}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── EVENTS ── */}
        {!loading && page === "events" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a" }}>
                All Events <span style={{ fontSize: 14, fontWeight: 400, color: "#94a3b8" }}>({events.length})</span>
              </div>
              <button onClick={fetchData}
                style={{
                  fontSize: 11, padding: "6px 14px", borderRadius: 6,
                  border: "1px solid #e2e8f0", cursor: "pointer", background: "#fff",
                  color: "#64748b", fontFamily: "inherit",
                }}>
                ↻ Refresh
              </button>
            </div>

            {events.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60, color: "#94a3b8", fontSize: 13 }}>
                <div style={{ marginBottom: 12, fontSize: 24 }}>📭</div>
                No events received yet.<br />
                <span style={{ fontSize: 11, marginTop: 8, display: "block" }}>
                  Send events to: <code style={{ background: "#f1f5f9", padding: "2px 6px", borderRadius: 4 }}>POST {INGESTION_URL}/ingest/event</code>
                </span>
              </div>
            ) : (
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead style={{ background: "#f8fafc" }}>
                    <tr>
                      {["Time", "Type", "Src IP", "Username", "Command / Payload", "Protocol"].map(h => (
                        <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 10, letterSpacing: "0.06em", borderBottom: "1px solid #e2e8f0" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...events].reverse().slice(0, 100).map((e, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #f8fafc" }}>
                        <td style={{ padding: "9px 14px", color: "#94a3b8", whiteSpace: "nowrap" }}>{fmt(e.timestamp)}</td>
                        <td style={{ padding: "9px 14px" }}>
                          <span style={{ color: eventColor(e.event_type), fontWeight: 600 }}>
                            {(e.event_type || "unknown").replace("cowrie.", "")}
                          </span>
                        </td>
                        <td style={{ padding: "9px 14px", color: "#0f172a" }}>{e.src_ip || "—"}</td>
                        <td style={{ padding: "9px 14px", color: "#475569" }}>{e.username || "—"}</td>
                        <td style={{ padding: "9px 14px", color: "#475569", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {e.command || e.payload || "—"}
                        </td>
                        <td style={{ padding: "9px 14px" }}>
                          <span style={{ background: "#f1f5f9", padding: "2px 6px", borderRadius: 4, fontSize: 10, color: "#475569" }}>{e.protocol || "—"}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── METRICS ── */}
        {!loading && page === "metrics" && (
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", marginBottom: 20 }}>Metrics</div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
              {[
                { label: "Total events",   value: events.length },
                { label: "Unique IPs",     value: new Set(events.map(e => e.src_ip)).size },
                { label: "Queue depth",    value: queueDepth },
                { label: "Sessions",       value: sessions.length },
              ].map(m => (
                <div key={m.label} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "16px 18px" }}>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6, letterSpacing: "0.06em" }}>{m.label}</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: "#0f172a" }}>{m.value}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 14, color: "#0f172a", letterSpacing: "0.04em" }}>EVENTS OVER TIME</div>
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={timeline}>
                    <defs>
                      <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="hour" tick={{ fontSize: 9, fontFamily: "inherit" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fontFamily: "inherit" }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ fontSize: 11, fontFamily: "inherit", border: "1px solid #e2e8f0", borderRadius: 6, boxShadow: "none" }} />
                    <Area type="monotone" dataKey="events" stroke="#10b981" strokeWidth={2} fill="url(#g2)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 14, color: "#0f172a", letterSpacing: "0.04em" }}>EVENTS BY TYPE</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {typeCounts.map(e => (
                    <div key={e.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: eventColor(e.full), flexShrink: 0 }} />
                      <div style={{ fontSize: 11, color: "#64748b", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</div>
                      <div style={{ flex: 2 }}>
                        <div style={{ height: 4, borderRadius: 2, background: "#f1f5f9", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${(e.count / (typeCounts[0]?.count || 1)) * 100}%`, background: eventColor(e.full), borderRadius: 2 }} />
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: "#94a3b8", minWidth: 24, textAlign: "right" }}>{e.count}</div>
                    </div>
                  ))}
                  {typeCounts.length === 0 && (
                    <div style={{ color: "#94a3b8", fontSize: 12, textAlign: "center", padding: 24 }}>No data yet</div>
                  )}
                </div>
              </div>
            </div>

            {/* API status */}
            <div style={{ marginTop: 16, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12, color: "#0f172a", letterSpacing: "0.04em" }}>INGESTION API STATUS</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
                {[
                  { label: "Status",      value: health?.status || "—" },
                  { label: "Redis",       value: health?.redis || "—" },
                  { label: "Queue depth", value: health?.queue_depth ?? "—" },
                ].map(r => (
                  <div key={r.label} style={{ background: "#f8fafc", borderRadius: 8, padding: "12px 14px" }}>
                    <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 4, letterSpacing: "0.06em" }}>{r.label}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>{String(r.value)}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, fontSize: 11, color: "#94a3b8" }}>
                Polling {INGESTION_URL} every {POLL_INTERVAL/1000}s
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
