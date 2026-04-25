import { useState, useEffect, useRef } from "react";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from "recharts";

const MOCK_SESSIONS = [
  { id: "172_19_0_1", ip: "172.19.0.1", protocol: "ssh", score: 4, level: 3, events: 17, last_seen: "01:08:50", status: "active" },
  { id: "10_0_2_44", ip: "10.0.2.44", protocol: "ssh", score: 2, level: 2, events: 8, last_seen: "00:45:12", status: "idle" },
  { id: "192_168_1_5", ip: "192.168.1.5", protocol: "http", score: 1, level: 1, events: 3, last_seen: "00:32:07", status: "idle" },
  { id: "10_0_2_98", ip: "10.0.2.98", protocol: "ssh", score: 5, level: 3, events: 23, last_seen: "01:02:33", status: "active" },
  { id: "172_16_0_3", ip: "172.16.0.3", protocol: "http", score: 0, level: 1, events: 2, last_seen: "00:18:45", status: "closed" },
];

const MOCK_EVENTS = [
  { time: "01:08:50", type: "connection_closed", username: null, detail: "Session ended" },
  { time: "01:05:50", type: "command_input", username: null, detail: "ls" },
  { time: "01:05:12", type: "command_input", username: null, detail: "(empty)" },
  { time: "01:04:01", type: "connection_new", username: null, detail: "New SSH connection" },
  { time: "01:04:00", type: "authentication_success", username: "root", detail: "Login as root" },
  { time: "01:03:31", type: "cowrie.client.kex", username: null, detail: "Key exchange" },
  { time: "01:03:31", type: "connection_new", username: null, detail: "New SSH connection" },
  { time: "00:56:56", type: "connection_closed", username: null, detail: "Session ended" },
  { time: "22:42:23", type: "command_input", username: null, detail: "exit" },
  { time: "22:42:14", type: "command_input", username: null, detail: "ls" },
  { time: "22:42:11", type: "command_input", username: null, detail: "mkdir aladdin" },
  { time: "22:42:05", type: "command_input", username: null, detail: "ls" },
  { time: "22:41:58", type: "authentication_success", username: "root", detail: "Login as root" },
];

const MOCK_DECISIONS = [
  { rule: "high_skill_persistent_attacker", action: "escalate_to_level_3", score: 4, time: "01:05:14" },
  { rule: "ssh_successful_login", action: "escalate_to_level_3", score: 4, time: "01:04:02" },
  { rule: "ssh_root_attempt", action: "flag", score: 1, time: "01:04:02" },
  { rule: "high_skill_persistent_attacker", action: "escalate_to_level_3", score: 0, time: "01:03:34" },
];

const MOCK_KG = {
  nodes: [
    { id: "172_19_0_1", type: "session", x: 340, y: 160 },
    { id: "evt_auth", type: "event", x: 180, y: 280, label: "auth_success" },
    { id: "evt_cmd1", type: "event", x: 340, y: 300, label: "command_input" },
    { id: "evt_cmd2", type: "event", x: 500, y: 280, label: "command_input" },
    { id: "rule_ssh_root", type: "rule", x: 120, y: 160, label: "ssh_root_attempt" },
    { id: "rule_persistent", type: "rule", x: 560, y: 160, label: "persistent_attacker" },
    { id: "rule_login", type: "rule", x: 340, y: 60, label: "ssh_successful_login" },
  ],
  edges: [
    { src: "172_19_0_1", dst: "evt_auth", rel: "has_event" },
    { src: "172_19_0_1", dst: "evt_cmd1", rel: "has_event" },
    { src: "172_19_0_1", dst: "evt_cmd2", rel: "has_event" },
    { src: "evt_auth", dst: "rule_ssh_root", rel: "matches_rule" },
    { src: "evt_auth", dst: "rule_login", rel: "matches_rule" },
    { src: "evt_cmd1", dst: "rule_persistent", rel: "matches_rule" },
    { src: "172_19_0_1", dst: "rule_persistent", rel: "triggered_rule" },
    { src: "172_19_0_1", dst: "rule_login", rel: "triggered_rule" },
  ],
};

const TIMELINE_DATA = [
  { hour: "22:00", events: 4 }, { hour: "23:00", events: 8 }, { hour: "00:00", events: 3 },
  { hour: "01:00", events: 12 }, { hour: "01:05", events: 6 }, { hour: "01:08", events: 2 },
];

const RULES_DATA = [
  { name: "high_skill", count: 7 }, { name: "ssh_login", count: 4 },
  { name: "ssh_root", count: 3 }, { name: "brute_force", count: 2 }, { name: "port_scan", count: 1 },
];

const POOL_DATA = [
  { name: "level1_pool", total: 5, busy: 1, idle: 4 },
  { name: "level2_pool", total: 3, busy: 1, idle: 2 },
  { name: "level3_pool", total: 1, busy: 1, idle: 0 },
];

const EVENT_COLORS = {
  authentication_success: "#10b981",
  authentication_failed: "#ef4444",
  command_input: "#3b82f6",
  connection_new: "#8b5cf6",
  connection_closed: "#6b7280",
  "cowrie.client.kex": "#f59e0b",
  "cowrie.client.size": "#f59e0b",
  "cowrie.client.version": "#f59e0b",
};

const LEVEL_COLORS = { 1: "#10b981", 2: "#f59e0b", 3: "#ef4444" };
const LEVEL_BG = { 1: "#d1fae5", 2: "#fef3c7", 3: "#fee2e2" };

function ScoreDot({ score }) {
  const colors = ["#6b7280","#10b981","#f59e0b","#f97316","#ef4444","#dc2626"];
  return (
    <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
      {[0,1,2,3,4,5].map(i => (
        <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: i <= score ? colors[Math.min(score,5)] : "#e5e7eb" }} />
      ))}
    </div>
  );
}

function KGGraph({ data }) {
  const nodeColors = { session: "#3b82f6", event: "#10b981", rule: "#f59e0b" };
  const nodeSize = { session: 22, event: 14, rule: 16 };

  return (
    <svg viewBox="0 0 680 360" width="100%" style={{ fontFamily: "var(--font-sans)" }}>
      <defs>
        <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill="#94a3b8" />
        </marker>
      </defs>
      {data.edges.map((e, i) => {
        const src = data.nodes.find(n => n.id === e.src);
        const dst = data.nodes.find(n => n.id === e.dst);
        if (!src || !dst) return null;
        const mx = (src.x + dst.x) / 2;
        const my = (src.y + dst.y) / 2;
        const angle = Math.atan2(dst.y - src.y, dst.x - src.x);
        const sr = nodeSize[src.type] || 14;
        const dr = nodeSize[dst.type] || 14;
        const x1 = src.x + Math.cos(angle) * sr;
        const y1 = src.y + Math.sin(angle) * sr;
        const x2 = dst.x - Math.cos(angle) * (dr + 6);
        const y2 = dst.y - Math.sin(angle) * (dr + 6);
        return (
          <g key={i}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#cbd5e1" strokeWidth="1.5" markerEnd="url(#arrow)" />
            <text x={mx} y={my - 4} textAnchor="middle" fontSize="9" fill="#94a3b8">{e.rel}</text>
          </g>
        );
      })}
      {data.nodes.map(n => (
        <g key={n.id}>
          <circle cx={n.x} cy={n.y} r={nodeSize[n.type] || 14} fill={nodeColors[n.type]} opacity="0.15" />
          <circle cx={n.x} cy={n.y} r={nodeSize[n.type] || 14} fill="none" stroke={nodeColors[n.type]} strokeWidth="1.5" />
          <text x={n.x} y={n.y + 1} textAnchor="middle" dominantBaseline="middle" fontSize="8" fontWeight="500" fill={nodeColors[n.type]}>
            {n.type === "session" ? "session" : (n.label || n.id).replace(/_/g," ").slice(0,12)}
          </text>
        </g>
      ))}
      <g transform="translate(12, 320)">
        {[["session","#3b82f6"],["event","#10b981"],["rule","#f59e0b"]].map(([label, color], i) => (
          <g key={label} transform={`translate(${i * 90}, 0)`}>
            <circle r="5" fill={color} opacity="0.3" stroke={color} strokeWidth="1.5" cx="5" cy="5" />
            <text x="14" y="9" fontSize="9" fill="#94a3b8">{label}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

export default function Dashboard() {
  const [page, setPage] = useState("home");
  const [selectedSession, setSelectedSession] = useState(null);
  const [sessionFilter, setSessionFilter] = useState("all");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 3000);
    return () => clearInterval(t);
  }, []);

  const totalEvents = 47 + tick;
  const activeSessions = MOCK_SESSIONS.filter(s => s.status === "active").length;
  const escalations = 6;

  const navItems = [
    { id: "home", label: "Overview" },
    { id: "sessions", label: "Sessions" },
    { id: "rules", label: "Rules" },
    { id: "pools", label: "Pools" },
    { id: "metrics", label: "Metrics" },
  ];

  const filteredSessions = sessionFilter === "all"
    ? MOCK_SESSIONS
    : MOCK_SESSIONS.filter(s => s.level === parseInt(sessionFilter));

  return (
    <div style={{ fontFamily: "var(--font-sans)", minHeight: "100vh", background: "var(--color-background-tertiary)" }}>
      <div style={{ background: "var(--color-background-primary)", borderBottom: "0.5px solid var(--color-border-tertiary)", padding: "0 24px", display: "flex", alignItems: "center", gap: 32, height: 52 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: "#1e293b", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="2.5" fill="#10b981" />
              <circle cx="7" cy="7" r="5.5" stroke="#10b981" strokeWidth="1" fill="none" opacity="0.4" />
              <circle cx="7" cy="7" r="6.5" stroke="#10b981" strokeWidth="0.5" fill="none" opacity="0.2" />
            </svg>
          </div>
          <span style={{ fontSize: 13, fontWeight: 500, letterSpacing: "0.02em" }}>Labyrinth</span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {navItems.map(n => (
            <button key={n.id} onClick={() => { setPage(n.id); setSelectedSession(null); }}
              style={{ padding: "6px 12px", borderRadius: "var(--border-radius-md)", fontSize: 13, border: "none", cursor: "pointer", fontFamily: "inherit",
                background: page === n.id ? "var(--color-background-secondary)" : "transparent",
                color: page === n.id ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                fontWeight: page === n.id ? 500 : 400 }}>
              {n.label}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#10b981", boxShadow: "0 0 0 2px #d1fae5" }} />
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>cerebrum · online</span>
        </div>
      </div>

      <div style={{ padding: "20px 24px", maxWidth: 1100, margin: "0 auto" }}>

        {/* HOME */}
        {page === "home" && !selectedSession && (
          <div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>dynamic labyrinth</div>
              <div style={{ fontSize: 20, fontWeight: 500 }}>Threat intelligence overview</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
              {[
                { label: "Total events", value: totalEvents, delta: "+12 last hr" },
                { label: "Active sessions", value: activeSessions, delta: "2 escalated" },
                { label: "Escalations", value: escalations, delta: "to level 3" },
                { label: "Rules loaded", value: 15, delta: "all active" },
              ].map(card => (
                <div key={card.label} style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "12px 16px" }}>
                  <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4 }}>{card.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 500, lineHeight: 1 }}>{card.value}</div>
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 4 }}>{card.delta}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 16 }}>
              <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 12 }}>Event activity</div>
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={TIMELINE_DATA}>
                    <defs>
                      <linearGradient id="eventGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ fontSize: 11, border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, boxShadow: "none" }} />
                    <Area type="monotone" dataKey="events" stroke="#3b82f6" strokeWidth={1.5} fill="url(#eventGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 12 }}>Top rules triggered</div>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={RULES_DATA} layout="vertical">
                    <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={80} />
                    <Tooltip contentStyle={{ fontSize: 11, border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, boxShadow: "none" }} />
                    <Bar dataKey="count" fill="#f59e0b" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 12 }}>Recent sessions</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                    {["IP", "Protocol", "Score", "Level", "Events", "Last seen", ""].map(h => (
                      <th key={h} style={{ padding: "6px 8px", textAlign: "left", fontWeight: 500, color: "var(--color-text-secondary)", fontSize: 11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MOCK_SESSIONS.map(s => (
                    <tr key={s.id} style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                      <td style={{ padding: "8px 8px", fontFamily: "var(--font-mono)", fontSize: 11 }}>{s.ip}</td>
                      <td style={{ padding: "8px 8px" }}><span style={{ background: "var(--color-background-secondary)", padding: "2px 6px", borderRadius: 4, fontSize: 10 }}>{s.protocol}</span></td>
                      <td style={{ padding: "8px 8px" }}><ScoreDot score={s.score} /></td>
                      <td style={{ padding: "8px 8px" }}><span style={{ background: LEVEL_BG[s.level], color: LEVEL_COLORS[s.level], padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 500 }}>L{s.level}</span></td>
                      <td style={{ padding: "8px 8px", color: "var(--color-text-secondary)" }}>{s.events}</td>
                      <td style={{ padding: "8px 8px", color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{s.last_seen}</td>
                      <td style={{ padding: "8px 8px" }}>
                        <button onClick={() => { setSelectedSession(s); setPage("detail"); }}
                          style={{ fontSize: 11, color: "var(--color-text-info)", border: "none", background: "none", cursor: "pointer", padding: 0, fontFamily: "inherit" }}>
                          Detail →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SESSIONS PAGE */}
        {page === "sessions" && !selectedSession && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 18, fontWeight: 500 }}>Sessions</div>
              <div style={{ display: "flex", gap: 4 }}>
                {["all","1","2","3"].map(f => (
                  <button key={f} onClick={() => setSessionFilter(f)}
                    style={{ padding: "5px 10px", borderRadius: "var(--border-radius-md)", fontSize: 12, fontFamily: "inherit",
                      border: "0.5px solid var(--color-border-secondary)", cursor: "pointer",
                      background: sessionFilter === f ? "var(--color-background-secondary)" : "transparent",
                      color: "var(--color-text-secondary)" }}>
                    {f === "all" ? "All" : `Level ${f}`}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filteredSessions.map(s => (
                <div key={s.id} style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 16, cursor: "pointer" }}
                  onClick={() => { setSelectedSession(s); setPage("detail"); }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: s.status === "active" ? "#10b981" : s.status === "idle" ? "#f59e0b" : "#d1d5db", flexShrink: 0 }} />
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, minWidth: 110 }}>{s.ip}</div>
                  <span style={{ background: "var(--color-background-secondary)", padding: "2px 6px", borderRadius: 4, fontSize: 10, color: "var(--color-text-secondary)" }}>{s.protocol}</span>
                  <ScoreDot score={s.score} />
                  <span style={{ background: LEVEL_BG[s.level], color: LEVEL_COLORS[s.level], padding: "2px 7px", borderRadius: 4, fontSize: 10, fontWeight: 500 }}>Level {s.level}</span>
                  <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-text-tertiary)" }}>{s.events} events · {s.last_seen}</div>
                  <div style={{ fontSize: 11, color: "var(--color-text-info)" }}>View →</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SESSION DETAIL */}
        {page === "detail" && selectedSession && (
          <div>
            <button onClick={() => { setSelectedSession(null); setPage("sessions"); }}
              style={{ fontSize: 12, color: "var(--color-text-secondary)", border: "none", background: "none", cursor: "pointer", padding: 0, marginBottom: 16, fontFamily: "inherit" }}>
              ← Back to sessions
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <div style={{ fontSize: 18, fontWeight: 500, fontFamily: "var(--font-mono)" }}>{selectedSession.ip}</div>
              <span style={{ background: LEVEL_BG[selectedSession.level], color: LEVEL_COLORS[selectedSession.level], padding: "3px 8px", borderRadius: 4, fontSize: 11, fontWeight: 500 }}>Level {selectedSession.level}</span>
              <ScoreDot score={selectedSession.score} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 14 }}>Event timeline</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  {MOCK_EVENTS.map((e, i) => (
                    <div key={i} style={{ display: "flex", gap: 12, paddingBottom: 12, position: "relative" }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <div style={{ width: 10, height: 10, borderRadius: "50%", background: EVENT_COLORS[e.type] || "#94a3b8", flexShrink: 0, marginTop: 2 }} />
                        {i < MOCK_EVENTS.length - 1 && <div style={{ width: 1, flex: 1, background: "var(--color-border-tertiary)", marginTop: 3 }} />}
                      </div>
                      <div style={{ flex: 1, paddingBottom: 4 }}>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontSize: 11, fontWeight: 500, color: EVENT_COLORS[e.type] || "var(--color-text-secondary)" }}>
                            {e.type.replace(/_/g, " ")}
                          </span>
                          <span style={{ fontSize: 10, color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)" }}>{e.time}</span>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 1 }}>
                          {e.username && <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-primary)", marginRight: 6 }}>{e.username}</span>}
                          {e.detail}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 14 }}>Decisions</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {MOCK_DECISIONS.map((d, i) => (
                      <div key={i} style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "10px 12px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                          <span style={{ fontSize: 11, fontWeight: 500, color: d.action.includes("level_3") ? "#ef4444" : d.action.includes("level_2") ? "#f59e0b" : "#6b7280" }}>
                            {d.action.replace(/_/g, " ")}
                          </span>
                          <span style={{ fontSize: 10, color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)" }}>{d.time}</span>
                        </div>
                        <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>rule: {d.rule} · score: {d.score}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Knowledge graph</div>
                  <KGGraph data={MOCK_KG} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* RULES */}
        {page === "rules" && (
          <div>
            <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 16 }}>Rules</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { id: "ssh_brute_force", desc: "6+ auth failures in 5min", delta: 3, action: "escalate_to_level_2", hits: 2 },
                { id: "ssh_root_attempt", desc: "Auth attempt as root", delta: 1, action: "flag", hits: 3 },
                { id: "ssh_successful_login", desc: "Successful SSH login", delta: 4, action: "escalate_to_level_3", hits: 4 },
                { id: "high_skill_persistent_attacker", desc: "score ≥ 4 and session active > 5min", delta: 2, action: "escalate_to_level_3", hits: 7 },
                { id: "command_dangerous", desc: "Commands: wget, curl, bash, nc", delta: 3, action: "escalate_to_level_2", hits: 0 },
                { id: "port_scan_detected", desc: "20+ connections in 1min", delta: 2, action: "flag", hits: 1 },
                { id: "repeated_session", desc: "Same IP, 3+ sessions", delta: 2, action: "escalate_to_level_2", hits: 0 },
              ].map(r => (
                <div key={r.id} style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "12px 16px", display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, fontFamily: "var(--font-mono)" }}>{r.id}</div>
                    <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>{r.desc}</div>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", minWidth: 60 }}>Δ score +{r.delta}</div>
                  <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: r.action.includes("3") ? "#fee2e2" : r.action.includes("2") ? "#fef3c7" : "#f3f4f6", color: r.action.includes("3") ? "#ef4444" : r.action.includes("2") ? "#d97706" : "#6b7280", fontWeight: 500 }}>
                    {r.action.replace(/_/g, " ")}
                  </span>
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", minWidth: 50, textAlign: "right" }}>{r.hits} hits</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* POOLS */}
        {page === "pools" && (
          <div>
            <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 16 }}>Container pools</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
              {POOL_DATA.map(p => (
                <div key={p.name} style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: 16 }}>
                  <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--color-text-secondary)", marginBottom: 8 }}>{p.name}</div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                    <div style={{ flex: 1, background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "8px 10px", textAlign: "center" }}>
                      <div style={{ fontSize: 18, fontWeight: 500 }}>{p.total}</div>
                      <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>total</div>
                    </div>
                    <div style={{ flex: 1, background: "#fef9c3", borderRadius: "var(--border-radius-md)", padding: "8px 10px", textAlign: "center" }}>
                      <div style={{ fontSize: 18, fontWeight: 500, color: "#d97706" }}>{p.busy}</div>
                      <div style={{ fontSize: 10, color: "#b45309" }}>busy</div>
                    </div>
                    <div style={{ flex: 1, background: "#d1fae5", borderRadius: "var(--border-radius-md)", padding: "8px 10px", textAlign: "center" }}>
                      <div style={{ fontSize: 18, fontWeight: 500, color: "#059669" }}>{p.idle}</div>
                      <div style={{ fontSize: 10, color: "#047857" }}>idle</div>
                    </div>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: "var(--color-background-secondary)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${(p.busy / p.total) * 100}%`, background: p.busy === p.total ? "#ef4444" : "#f59e0b", borderRadius: 3 }} />
                  </div>
                  <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginTop: 4 }}>{Math.round((p.busy / p.total) * 100)}% utilization</div>
                </div>
              ))}
            </div>
            <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 12 }}>nginx routing map (preview)</div>
              <pre style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-text-secondary)", background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "12px 14px", overflowX: "auto", margin: 0 }}>
{`map $cookie_dlsess $honeytrap_upstream {
    default "level1_pool";
    "dlsess_a3f2b1c4" "10.0.2.7:8080";
    "dlsess_9e8d7c6b" "10.0.2.12:8080";
    "dlsess_1a2b3c4d" "10.0.2.21:8080";
}`}
              </pre>
            </div>
          </div>
        )}

        {/* METRICS */}
        {page === "metrics" && (
          <div>
            <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 16 }}>Metrics</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
              {[
                { label: "Avg events/session", value: "9.4" },
                { label: "Escalation rate", value: "40%" },
                { label: "Mean skill score", value: "2.4" },
                { label: "Engagement ratio", value: "0.73" },
              ].map(m => (
                <div key={m.label} style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "12px 16px" }}>
                  <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4 }}>{m.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 500 }}>{m.value}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 12 }}>Escalations over time</div>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={[
                    { t: "22h", v: 1 }, { t: "23h", v: 2 }, { t: "00h", v: 0 },
                    { t: "01h", v: 3 }, { t: "now", v: 6 },
                  ]}>
                    <XAxis dataKey="t" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ fontSize: 11, border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, boxShadow: "none" }} />
                    <Line type="monotone" dataKey="v" stroke="#ef4444" strokeWidth={1.5} dot={{ r: 3, fill: "#ef4444" }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 12 }}>Events by type</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    { type: "command_input", count: 17, color: "#3b82f6" },
                    { type: "connection_new", count: 12, color: "#8b5cf6" },
                    { type: "authentication_success", count: 8, color: "#10b981" },
                    { type: "connection_closed", count: 7, color: "#6b7280" },
                    { type: "authentication_failed", count: 3, color: "#ef4444" },
                  ].map(e => (
                    <div key={e.type} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: e.color, flexShrink: 0 }} />
                      <div style={{ fontSize: 11, color: "var(--color-text-secondary)", flex: 1 }}>{e.type.replace(/_/g, " ")}</div>
                      <div style={{ flex: 2 }}>
                        <div style={{ height: 4, borderRadius: 2, background: "var(--color-background-secondary)", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${(e.count / 17) * 100}%`, background: e.color, borderRadius: 2 }} />
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", minWidth: 20, textAlign: "right" }}>{e.count}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
