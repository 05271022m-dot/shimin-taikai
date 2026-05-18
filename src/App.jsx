import { useState, useEffect, useRef } from "react";
import { doc, onSnapshot, setDoc, updateDoc, arrayUnion, deleteField } from "firebase/firestore";
import { db } from "./firebase.js";

// ─── Firestore Document ───────────────────────────────────────────────────────
const SESSION_DOC = doc(db, "sessions", "default");

const DEFAULT_STATE = {
  started: false,
  timer: { running: false, startedAt: null, acc: 0, target: 0 },
  announcements: [],
  question: null,
  answers: {},
  opinions: {},
};

// ─── Config ───────────────────────────────────────────────────────────────────
const MAYOR_PASSWORD = "sorasora";

const OFFICERS = [
  { id: "mayor", name: "岸部昊市長",      title: "市長",  label: "🏛️ 岸部昊　市長",        hasPassword: true  },
  { id: "vice1", name: "碇谷柊副市長",     title: "副市長", label: "🤝 碇谷柊　副市長",      hasPassword: false },
  { id: "vice2", name: "佐々木夏穂副市長", title: "副市長", label: "🤝 佐々木夏穂　副市長",  hasPassword: false },
];

const GROUP_NAMES = Array.from({ length: 17 }, (_, i) => `第${i + 1}班`);
const KU_LIST = ["3年AC区", "3年B区", "2年A区", "2年B区", "1年A区", "1年B区"];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);
const nowTime = () => new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
const fmtSec = (s) => {
  const n = Math.abs(Math.floor(s || 0));
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
};
const makeUserId = (ku, number) => `${ku}-${number}`;

// ─── Session Hook ─────────────────────────────────────────────────────────────
function useSession() {
  const [data, setData]       = useState(DEFAULT_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    let initialized = false;
    const unsub = onSnapshot(
      SESSION_DOC,
      async (snap) => {
        if (snap.exists()) {
          setData({ ...DEFAULT_STATE, ...snap.data() });
        } else if (!initialized) {
          initialized = true;
          try { await setDoc(SESSION_DOC, DEFAULT_STATE); } catch (e) { console.error(e); }
        }
        setLoading(false);
      },
      (err) => { console.error("Firestore error:", err); setError(err); setLoading(false); }
    );
    return unsub;
  }, []);

  return { data, loading, error };
}

// ─── Mutation Functions ───────────────────────────────────────────────────────
const updateSession    = (changes)        => updateDoc(SESSION_DOC, changes);
const setSessionStart  = (started)        => updateSession({ started });
const addAnnouncement  = (a)              => updateSession({ announcements: arrayUnion(a) });
const setQuestion      = (q)              => updateSession({ question: q, answers: {}, opinions: {} });
const setGroupAnswer   = (g, a)           => updateSession({ [`answers.${g}`]: a });
const setTimerState    = (t)              => updateSession({ timer: t });
const resetSession     = ()               => setDoc(SESSION_DOC, DEFAULT_STATE);

// Opinion mutations
const addOpinion       = (g, op)          => updateSession({ [`opinions.${g}.${op.id}`]: op });
const removeOpinion    = (g, opId)        => updateSession({ [`opinions.${g}.${opId}`]: deleteField() });

const toggleReaction = async (currentOpinions, g, opId, field, userId) => {
  const op = currentOpinions?.[g]?.[opId];
  if (!op) return;
  const list = op[field] || [];
  const has = list.includes(userId);
  const newList = has ? list.filter(u => u !== userId) : [...list, userId];
  await updateSession({ [`opinions.${g}.${opId}.${field}`]: newList });
};

// Timer controls
const timerSet   = (target)        => setTimerState({ running: false, startedAt: null, acc: 0, target });
const timerStart = (acc, target)   => setTimerState({ running: true,  startedAt: Date.now(), acc, target });
const timerStop  = (acc, target)   => setTimerState({ running: false, startedAt: null, acc, target });
const timerReset = (target)        => setTimerState({ running: false, startedAt: null, acc: 0, target });

// ─── Countdown ────────────────────────────────────────────────────────────────
function useCountdown(timer) {
  const [rem, setRem] = useState(0);
  useEffect(() => {
    const tick = () => {
      if (!timer) { setRem(0); return; }
      const elapsed = timer.running && timer.startedAt
        ? (timer.acc || 0) + (Date.now() - timer.startedAt) / 1000
        : (timer.acc || 0);
      setRem(Math.max(0, (timer.target || 0) - elapsed));
    };
    tick();
    const t = setInterval(tick, 200);
    return () => clearInterval(t);
  }, [timer]);
  const isRunning = !!timer?.running;
  const target    = timer?.target || 0;
  const isTimeUp  = target > 0 && rem <= 0 && ((timer?.acc || 0) > 0 || isRunning);
  return { rem, isRunning, isTimeUp, target, display: fmtSec(rem) };
}

// ─── TimerBadge ───────────────────────────────────────────────────────────────
function TimerBadge({ rem, isRunning, isTimeUp, display }) {
  const cls = isTimeUp                       ? "bg-red-950 text-red-400 border-red-700 animate-pulse"
            : rem <= 30 && isRunning         ? "bg-red-950 text-red-400 border-red-800"
            : rem <= 60 && isRunning         ? "bg-amber-950 text-amber-300 border-amber-800"
            : isRunning                      ? "bg-emerald-950 text-emerald-300 border-emerald-700"
            :                                  "bg-slate-900 text-slate-400 border-slate-700";
  return (
    <div style={{ fontFamily: "'Courier New', monospace" }}
      className={`text-xl px-3 py-1 rounded-lg tabular-nums tracking-widest border transition-all ${cls}`}>
      {isTimeUp ? "TIME UP" : display}
    </div>
  );
}

// ─── QR Modal ─────────────────────────────────────────────────────────────────
function QRModal({ onClose }) {
  const [url, setUrl]         = useState(window.location.href);
  const [libReady, setLibReady] = useState(false);
  const [copied, setCopied]   = useState(false);
  const qrBox = useRef(null);

  useEffect(() => {
    if (window.QRCode) { setLibReady(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
    s.onload  = () => setLibReady(true);
    s.onerror = () => setLibReady(false);
    document.head.appendChild(s);
  }, []);

  useEffect(() => {
    if (!libReady || !url.trim() || !qrBox.current) return;
    qrBox.current.innerHTML = "";
    try {
      new window.QRCode(qrBox.current, {
        text: url.trim(), width: 220, height: 220,
        colorDark: "#0f172a", colorLight: "#f8fafc",
        correctLevel: window.QRCode?.CorrectLevel?.M ?? 0,
      });
    } catch {}
  }, [url, libReady]);

  const copy = () => {
    try { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.92)", backdropFilter: "blur(10px)" }}>
      <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 max-w-xs w-full shadow-2xl">
        <div className="text-center mb-4">
          <div className="text-xs text-blue-400 tracking-[0.2em] mb-1">SHARE</div>
          <h3 className="text-white font-bold text-xl">QRコードで共有</h3>
        </div>
        <div className="flex justify-center mb-4">
          <div className="rounded-2xl overflow-hidden border-4 border-white bg-white flex items-center justify-center"
            style={{ width: 248, height: 248 }}>
            {url.trim() ? <div ref={qrBox} /> : <div className="text-slate-300 text-xs p-6">URLを入力してください</div>}
          </div>
        </div>
        <textarea value={url} onChange={(e) => setUrl(e.target.value)} rows={2}
          className="w-full bg-slate-950 border border-slate-700 focus:border-blue-500 rounded-xl p-3 text-blue-300 text-xs resize-none outline-none mb-3" />
        <div className="flex gap-2 mb-3">
          <button onClick={copy}
            className={`flex-1 py-3 rounded-xl text-sm font-bold border ${copied ? "bg-emerald-900 border-emerald-700 text-emerald-300" : "bg-slate-800 border-slate-700 text-slate-300"}`}>
            {copied ? "✅ コピー済み" : "URLをコピー"}
          </button>
          <button onClick={onClose} className="flex-1 py-3 rounded-xl text-sm font-bold text-white"
            style={{ background: "linear-gradient(135deg,#1e3a8a,#1d4ed8)" }}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("home");
  const [user, setUser]     = useState(null);
  const [showQR, setShowQR] = useState(false);
  const { data, loading, error } = useSession();

  const nav    = (s, u) => { if (u !== undefined) setUser(u); setScreen(s); };
  const logout = () => nav("home", null);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-500">
      <div className="text-center"><div className="text-4xl mb-3 animate-pulse">🌆</div><div className="text-sm">接続中...</div></div>
    </div>;
  }
  if (error) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
      <div className="max-w-sm text-center">
        <div className="text-5xl mb-4">⚠️</div>
        <div className="text-white font-bold mb-2">接続エラー</div>
        <div className="text-slate-500 text-sm mb-4">Firebase の設定を確認してください</div>
        <div className="text-slate-600 text-xs bg-slate-900 rounded-lg p-3 text-left">{error.message}</div>
      </div>
    </div>;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {showQR && <QRModal onClose={() => setShowQR(false)} />}
      {screen === "home"   && <Home onCitizen={() => nav("cLogin")} onOfficer={() => nav("oLogin")} onTeacher={() => nav("tRoom", { role: "teacher" })} onQR={() => setShowQR(true)} />}
      {screen === "cLogin" && <CitizenLogin onBack={() => nav("home")} onNext={(d) => nav("cGroup", { role: "citizen", ...d })} />}
      {screen === "cGroup" && <CitizenGroup onBack={() => nav("cLogin")} onEnter={(g, l) => nav("cRoom", { ...user, group: g, isLeader: l })} />}
      {screen === "cRoom"  && <CitizenRoom  user={user} session={data} onLogout={logout} onQR={() => setShowQR(true)} />}
      {screen === "oLogin" && <OfficerLogin onBack={() => nav("home")} onLogin={(o) => nav("oRoom", { role: "officer", ...o })} />}
      {screen === "oRoom"  && <OfficerRoom  user={user} session={data} onLogout={logout} onQR={() => setShowQR(true)} />}
      {screen === "tRoom"  && <TeacherRoom  session={data} onLogout={logout} onQR={() => setShowQR(true)} />}
    </div>
  );
}

// ─── QR Button ────────────────────────────────────────────────────────────────
function QRBtn({ onQR }) {
  return (
    <button onClick={onQR} title="QRコードで共有"
      className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-700 hover:border-slate-400 text-slate-500 hover:text-slate-200">
      ⬛
    </button>
  );
}

// ─── Live Indicator ───────────────────────────────────────────────────────────
function LiveBar() {
  return (
    <div className="text-center py-1 text-xs text-emerald-500 border-b border-slate-800/40 flex items-center justify-center gap-2"
      style={{ background: "rgba(15,23,42,0.8)" }}>
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
      <span>リアルタイム接続中</span>
    </div>
  );
}

// ─── Home ─────────────────────────────────────────────────────────────────────
function Home({ onCitizen, onOfficer, onTeacher, onQR }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden"
      style={{ background: "linear-gradient(135deg,#0a0f1e 0%,#0d1b3e 50%,#0a0f1e 100%)" }}>
      <div className="absolute inset-0 opacity-5" style={{ backgroundImage: "linear-gradient(#4f7ed4 1px,transparent 1px),linear-gradient(90deg,#4f7ed4 1px,transparent 1px)", backgroundSize: "40px 40px" }} />
      {[["top-6 left-6","border-t-2 border-l-2 rounded-tl-lg"],["top-6 right-6","border-t-2 border-r-2 rounded-tr-lg"],["bottom-6 left-6","border-b-2 border-l-2 rounded-bl-lg"],["bottom-6 right-6","border-b-2 border-r-2 rounded-br-lg"]].map(([p,c]) => (
        <div key={p} className={`absolute ${p} w-12 h-12 border-blue-500/40 ${c}`} />
      ))}
      <div className="relative z-10 w-full max-w-xs text-center">
        <div className="mb-10">
          <div className="inline-block border border-blue-500/30 rounded-full px-4 py-1 mb-4">
            <span className="text-blue-400 text-xs tracking-[0.2em]">能代第一中学校 学校都市</span>
          </div>
          <div className="text-8xl font-black tracking-tighter" style={{ textShadow: "0 0 60px rgba(99,147,255,0.3)" }}>2026</div>
          <div className="text-2xl font-bold tracking-widest mt-1"
            style={{ background: "linear-gradient(90deg,#60a5fa,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>市民大会</div>
        </div>
        <div className="space-y-3">
          <button onClick={onCitizen} className="w-full py-5 rounded-2xl font-bold text-lg active:scale-95 border border-blue-500/40"
            style={{ background: "linear-gradient(135deg,#1e3a8a,#1d4ed8)", boxShadow: "0 8px 32px rgba(29,78,216,0.4)" }}>🏙️ 市民として参加</button>
          <button onClick={onOfficer} className="w-full py-5 rounded-2xl font-bold text-lg active:scale-95 border border-amber-500/40 text-slate-900"
            style={{ background: "linear-gradient(135deg,#d97706,#f59e0b)", boxShadow: "0 8px 32px rgba(217,119,6,0.4)" }}>👑 三役として参加</button>
          <button onClick={onTeacher} className="w-full py-5 rounded-2xl font-bold text-lg active:scale-95 border border-emerald-500/40"
            style={{ background: "linear-gradient(135deg,#065f46,#059669)", boxShadow: "0 8px 32px rgba(5,150,105,0.3)" }}>📋 教師として参加</button>
        </div>
        <button onClick={onQR} className="mt-7 flex items-center gap-2 mx-auto px-5 py-2.5 rounded-xl border border-slate-700 hover:border-blue-600/60 text-slate-400 hover:text-blue-300 text-sm">
          ⬛ QRコードで参加者を招待
        </button>
      </div>
    </div>
  );
}

// ─── Citizen Login ────────────────────────────────────────────────────────────
function CitizenLogin({ onBack, onNext }) {
  const [ku, setKu] = useState(""); const [num, setNum] = useState(""); const [name, setName] = useState("");
  const ok = ku && num && name.trim();
  return (
    <div className="min-h-screen p-6 flex flex-col bg-slate-950">
      <button onClick={onBack} className="text-blue-400 mb-6 text-sm self-start">← 戻る</button>
      <div className="mb-8"><div className="text-xs text-blue-500 tracking-widest mb-1">CITIZEN LOGIN</div><h2 className="text-2xl font-bold">市民ログイン</h2></div>
      <div className="space-y-5">
        <Field label="区">
          <select value={ku} onChange={(e) => setKu(e.target.value)} className="w-full bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl px-4 py-3 text-white outline-none">
            <option value="">選択してください</option>
            {KU_LIST.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </Field>
        <Field label="出席番号"><input type="number" value={num} onChange={(e) => setNum(e.target.value)} placeholder="例: 15"
          className="w-full bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl px-4 py-3 text-white placeholder-slate-600 outline-none" /></Field>
        <Field label="名前"><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 能代 太郎"
          className="w-full bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl px-4 py-3 text-white placeholder-slate-600 outline-none" /></Field>
        <button onClick={() => ok && onNext({ ku, number: num, name: name.trim() })} disabled={!ok}
          className="w-full py-4 rounded-xl font-bold text-lg active:scale-95 disabled:opacity-30"
          style={ok ? { background: "linear-gradient(135deg,#1e3a8a,#1d4ed8)" } : { background: "#1e293b", color: "#475569" }}>
          次へ →
        </button>
      </div>
    </div>
  );
}

// ─── Citizen Group ────────────────────────────────────────────────────────────
function CitizenGroup({ onBack, onEnter }) {
  const [sel, setSel] = useState(null); const [isLeader, setIsLeader] = useState(false);
  return (
    <div className="min-h-screen p-6 flex flex-col bg-slate-950">
      <button onClick={onBack} className="text-blue-400 mb-4 text-sm self-start">← 戻る</button>
      <div className="mb-5"><div className="text-xs text-blue-500 tracking-widest mb-1">GROUP SELECT</div><h2 className="text-2xl font-bold">班を選択（全{GROUP_NAMES.length}班）</h2><p className="text-slate-500 text-sm mt-1">事前に振り分けられた班を選んでください</p></div>
      <div className="grid grid-cols-3 gap-2 mb-5">
        {GROUP_NAMES.map((g, i) => (
          <button key={g} onClick={() => setSel(i)}
            className={`py-3 rounded-xl font-bold text-sm active:scale-95 border ${sel === i ? "border-blue-500" : "border-slate-800 text-slate-400 bg-slate-900"}`}
            style={sel === i ? { background: "linear-gradient(135deg,#1e3a8a,#1d4ed8)", boxShadow: "0 4px 20px rgba(29,78,216,0.4)" } : {}}>
            {g}
          </button>
        ))}
      </div>
      <button onClick={() => setIsLeader(!isLeader)}
        className={`flex items-center gap-3 p-4 rounded-xl border mb-5 ${isLeader ? "border-amber-500/60 bg-amber-950/20" : "border-slate-700 bg-slate-900/50"}`}>
        <div className={`w-6 h-6 rounded border-2 flex items-center justify-center shrink-0 ${isLeader ? "border-amber-500" : "border-slate-600"}`}
          style={isLeader ? { background: "linear-gradient(135deg,#d97706,#f59e0b)" } : {}}>
          {isLeader && <span className="text-slate-900 text-xs font-black">✓</span>}
        </div>
        <span className={`font-medium ${isLeader ? "text-amber-300" : "text-slate-400"}`}>リーダーとして入室する 👑</span>
      </button>
      <button onClick={() => sel !== null && onEnter(sel, isLeader)} disabled={sel === null}
        className="w-full py-4 rounded-xl font-bold text-lg active:scale-95 disabled:opacity-30"
        style={sel !== null ? { background: "linear-gradient(135deg,#1e3a8a,#1d4ed8)", boxShadow: "0 8px 24px rgba(29,78,216,0.4)" } : { background: "#1e293b", color: "#475569" }}>
        入室する
      </button>
    </div>
  );
}

// ─── Opinion Card (Citizen view, interactive) ─────────────────────────────────
function OpinionCard({ opinion, currentUserId, onToggleLike, onToggleQuestion, onDelete }) {
  const isOwn = opinion.userId === currentUserId;
  const liked = opinion.likes?.includes(currentUserId);
  const questioned = opinion.questions?.includes(currentUserId);
  const likeCount = opinion.likes?.length || 0;
  const qCount = opinion.questions?.length || 0;

  return (
    <div className={`rounded-xl p-3 border ${isOwn ? "bg-blue-950/30 border-blue-800/40" : "bg-slate-900 border-slate-800"}`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-xs flex items-center gap-2 flex-wrap">
          <span className={isOwn ? "text-amber-300 font-bold" : "text-blue-400 font-medium"}>{opinion.userName}</span>
          {isOwn && <span className="text-amber-500 text-[10px] bg-amber-950/50 px-1.5 py-0.5 rounded">あなた</span>}
          <span className="text-slate-500">{opinion.time}</span>
        </div>
        {isOwn && (
          <button onClick={onDelete} className="text-slate-600 hover:text-red-500 text-xs px-2 py-0.5 rounded">削除</button>
        )}
      </div>
      <p className="text-white text-sm whitespace-pre-wrap leading-relaxed mb-2">{opinion.text}</p>
      <div className="flex gap-2">
        <button onClick={onToggleLike}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all active:scale-95 ${
            liked
              ? "bg-blue-900 border-blue-500 text-blue-200"
              : "bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500"
          }`}>
          👍 イイネ{likeCount > 0 && <span className="ml-1">{likeCount}</span>}
        </button>
        <button onClick={onToggleQuestion}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all active:scale-95 ${
            questioned
              ? "bg-purple-900 border-purple-500 text-purple-200"
              : "bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500"
          }`}>
          ❓ 質問！{qCount > 0 && <span className="ml-1">{qCount}</span>}
        </button>
      </div>
    </div>
  );
}

// ─── Citizen Room ─────────────────────────────────────────────────────────────
function CitizenRoom({ user, session, onLogout, onQR }) {
  const cd = useCountdown(session.timer);
  const { announcements, question, answers, opinions, started } = session;
  const [answerText, setAnswerText] = useState("");
  const [opinionText, setOpinionText] = useState("");
  const [savingAnswer, setSavingAnswer] = useState(false);
  const [savingOpinion, setSavingOpinion] = useState(false);

  const gk = String(user.group);
  const groupAnswer = answers?.[gk];
  const groupOpinions = opinions?.[gk] || {};
  const opinionsList = Object.values(groupOpinions).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const userId = makeUserId(user.ku, user.number);

  useEffect(() => { setAnswerText(""); setOpinionText(""); }, [question?.id]);

  const submitAnswer = async () => {
    if (!answerText.trim() || !question) return;
    setSavingAnswer(true);
    try {
      await setGroupAnswer(gk, {
        text: answerText.trim(),
        leaderName: user.name,
        time: nowTime(),
        questionId: question.id
      });
    } catch (e) { console.error(e); }
    setSavingAnswer(false);
  };

  const submitOpinion = async () => {
    if (!opinionText.trim() || !question) return;
    setSavingOpinion(true);
    try {
      const opId = uid();
      await addOpinion(gk, {
        id: opId,
        userId,
        userName: user.name,
        userKu: user.ku,
        userNumber: user.number,
        text: opinionText.trim(),
        time: nowTime(),
        ts: Date.now(),
        questionId: question.id,
        likes: [],
        questions: []
      });
      setOpinionText("");
    } catch (e) { console.error(e); }
    setSavingOpinion(false);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950">
      <header className="px-4 py-3 flex items-center justify-between sticky top-0 z-10 border-b border-slate-800"
        style={{ background: "rgba(10,15,30,0.97)", backdropFilter: "blur(12px)" }}>
        <div>
          <div className="text-xs text-blue-400">{user.ku} · No.{user.number} · {user.name}</div>
          <div className="font-bold text-sm mt-0.5">{GROUP_NAMES[user.group]}{user.isLeader && <span className="ml-2 text-amber-400 text-xs">👑 リーダー</span>}</div>
        </div>
        <div className="flex items-center gap-2">
          <TimerBadge {...cd} />
          <QRBtn onQR={onQR} />
          <button onClick={onLogout} className="text-slate-600 text-xs">退室</button>
        </div>
      </header>
      <LiveBar />

      {!started ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="text-6xl mb-5">🌆</div>
          <div className="text-xl font-bold mb-2">大会開始前です</div>
          <div className="text-slate-500 text-sm">岸部昊市長が大会を開始するまで<br />しばらくお待ちください</div>
          {announcements?.length > 0 && (
            <div className="mt-8 w-full max-w-sm space-y-2">
              {[...announcements].reverse().map((a) => (
                <div key={a.id} className="rounded-xl p-3 border border-amber-700/30 text-left" style={{ background: "rgba(120,53,15,0.2)" }}>
                  <div className="text-amber-400 text-xs font-semibold mb-1">📢 {a.from} · {a.time}</div>
                  <p className="text-white text-sm">{a.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {announcements?.length > 0 && (
            <div className="space-y-2">
              {[...announcements].reverse().map((a) => (
                <div key={a.id} className="rounded-xl p-3 border border-amber-700/30" style={{ background: "rgba(120,53,15,0.2)" }}>
                  <div className="flex items-center gap-2 mb-1"><span className="text-amber-400 text-xs font-semibold">📢 {a.from}</span><span className="text-slate-500 text-xs">{a.time}</span></div>
                  <p className="text-white text-sm leading-relaxed">{a.text}</p>
                </div>
              ))}
            </div>
          )}

          {question ? (
            <div className="rounded-xl p-4 border border-blue-700/30" style={{ background: "rgba(30,58,138,0.2)" }}>
              <div className="flex items-center gap-2 mb-3"><span className="text-blue-400 text-xs font-semibold">❓ 議題</span><span className="text-slate-500 text-xs">{question.time}</span></div>
              <p className="text-white font-semibold text-lg mb-4 leading-snug">{question.text}</p>

              {/* === Group Opinions Section === */}
              <div className="pt-4 border-t border-slate-700/50">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-blue-300 text-sm font-semibold">💭 班の意見を共有</span>
                  <span className="text-slate-500 text-xs">{opinionsList.length} 件</span>
                </div>

                {/* Opinion input */}
                <div className="mb-4 bg-slate-900/60 border border-slate-700 rounded-xl p-2">
                  <textarea
                    value={opinionText}
                    onChange={(e) => setOpinionText(e.target.value)}
                    placeholder={`${user.name}としての意見を書く...`}
                    rows={2}
                    className="w-full bg-transparent text-white placeholder-slate-600 text-sm resize-none outline-none p-1" />
                  <button onClick={submitOpinion} disabled={!opinionText.trim() || savingOpinion}
                    className="mt-1 w-full py-2 rounded-lg font-semibold text-sm active:scale-95 disabled:opacity-30"
                    style={{ background: "linear-gradient(135deg,#1e3a8a,#1d4ed8)" }}>
                    {savingOpinion ? "投稿中..." : "📝 意見を投稿"}
                  </button>
                </div>

                {/* Opinions list */}
                {opinionsList.length === 0 ? (
                  <div className="text-center py-6 text-slate-600 text-sm">まだ誰も意見を出していません<br />最初の一人になろう！</div>
                ) : (
                  <div className="space-y-2">
                    {opinionsList.map((op) => (
                      <OpinionCard
                        key={op.id}
                        opinion={op}
                        currentUserId={userId}
                        onToggleLike={() => toggleReaction(opinions, gk, op.id, "likes", userId)}
                        onToggleQuestion={() => toggleReaction(opinions, gk, op.id, "questions", userId)}
                        onDelete={() => removeOpinion(gk, op.id)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* === Leader Summary Section === */}
              {user.isLeader && (
                <div className="pt-4 mt-4 border-t border-amber-700/30">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-amber-300 text-sm font-semibold">👑 班の代表意見（リーダーのみ）</span>
                  </div>
                  <p className="text-slate-500 text-xs mb-3 leading-relaxed">
                    上の意見を参考に、班の代表として一つにまとめて提出してください
                  </p>

                  {groupAnswer && groupAnswer.questionId === question.id && (
                    <div className="bg-slate-900 border border-emerald-800/40 rounded-lg p-3 mb-3">
                      <div className="text-emerald-400 text-xs font-medium mb-1">✅ 提出済み · {groupAnswer.time}</div>
                      <p className="text-white text-sm whitespace-pre-wrap">{groupAnswer.text}</p>
                    </div>
                  )}

                  <textarea
                    value={answerText}
                    onChange={(e) => setAnswerText(e.target.value)}
                    placeholder="班の意見をまとめた最終回答..."
                    rows={4}
                    className="w-full bg-slate-900 border border-slate-700 focus:border-amber-600 rounded-lg p-3 text-white placeholder-slate-600 text-sm resize-none outline-none" />
                  <button onClick={submitAnswer} disabled={!answerText.trim() || savingAnswer}
                    className="mt-2 w-full py-3 rounded-lg font-bold active:scale-95 disabled:opacity-30"
                    style={{ background: "linear-gradient(135deg,#d97706,#f59e0b)", color: "#1e293b" }}>
                    {savingAnswer ? "提出中..." : groupAnswer ? "班の代表意見を更新する" : "👑 班の代表意見として提出する"}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-20"><div className="text-5xl mb-4">🌆</div><p className="text-slate-500">三役からの議題を待っています</p></div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Officer Login ────────────────────────────────────────────────────────────
function OfficerLogin({ onBack, onLogin }) {
  const [sel, setSel] = useState(null);
  const [pw, setPw]   = useState("");
  const [err, setErr] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const chosen = sel !== null ? OFFICERS[sel] : null;

  const handleEnter = () => {
    if (!chosen) return;
    if (chosen.hasPassword && pw !== MAYOR_PASSWORD) { setErr(true); return; }
    setErr(false); onLogin(chosen);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-950">
      <div className="w-full max-w-xs">
        <button onClick={onBack} className="text-amber-400 mb-8 text-sm self-start">← 戻る</button>
        <div className="mb-6"><div className="text-xs text-amber-500/70 tracking-widest mb-1">OFFICER LOGIN</div><h2 className="text-2xl font-bold">三役ログイン</h2></div>
        <div className="space-y-2 mb-5">
          {OFFICERS.map((o, i) => (
            <button key={o.id} onClick={() => { setSel(i); setPw(""); setErr(false); }}
              className={`w-full py-4 rounded-2xl font-bold text-lg active:scale-95 border text-left px-5 ${sel === i ? "border-amber-400" : "border-slate-700 bg-slate-900 text-slate-300"}`}
              style={sel === i ? { background: "linear-gradient(135deg,#92400e,#d97706)", color: "#fef3c7" } : {}}>
              {o.label}
            </button>
          ))}
        </div>
        {chosen?.hasPassword && (
          <div className="mb-4">
            <div className="relative">
              <input type={showPw ? "text" : "password"} value={pw}
                onChange={(e) => { setPw(e.target.value); setErr(false); }}
                onKeyDown={(e) => e.key === "Enter" && handleEnter()}
                placeholder="パスワードを入力"
                className={`w-full bg-slate-900 border rounded-xl px-4 py-3 text-white placeholder-slate-600 outline-none pr-12 ${err ? "border-red-600" : "border-slate-700 focus:border-amber-500"}`} />
              <button onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">{showPw ? "隠す" : "表示"}</button>
            </div>
            {err && <p className="text-red-400 text-xs mt-1 ml-1">パスワードが違います</p>}
          </div>
        )}
        <button onClick={handleEnter} disabled={!chosen || (chosen.hasPassword && !pw)}
          className="w-full py-4 rounded-2xl font-bold text-lg active:scale-95 disabled:opacity-30"
          style={{ background: "linear-gradient(135deg,#d97706,#f59e0b)", color: "#1e293b" }}>
          入室する
        </button>
      </div>
    </div>
  );
}

// ─── Group Detail Card (Officer / Teacher view with expansion) ────────────────
function GroupDetailCard({ groupIdx, answer, opinionsMap }) {
  const [expanded, setExpanded] = useState(false);
  const opinionsList = Object.values(opinionsMap || {}).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const hasOpinions = opinionsList.length > 0;

  return (
    <div className={`rounded-xl border ${answer ? "bg-slate-900 border-slate-700" : "bg-slate-950 border-slate-800/50"}`}>
      <div className="p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="font-bold text-sm">{GROUP_NAMES[groupIdx]}</span>
          <span className={`text-xs font-medium ${answer ? "text-emerald-400" : "text-slate-600"}`}>{answer ? "✅ 提出済" : "⏳ 未提出"}</span>
        </div>
        {answer && (
          <>
            <p className="text-white text-sm whitespace-pre-wrap leading-relaxed">{answer.text}</p>
            <p className="text-slate-500 text-xs mt-2">👑 {answer.leaderName} · {answer.time}</p>
          </>
        )}
      </div>
      {hasOpinions && (
        <>
          <button onClick={() => setExpanded(!expanded)}
            className="w-full px-3 py-2 border-t border-slate-800 text-slate-500 text-xs flex items-center justify-between hover:text-slate-300 hover:bg-slate-900/50">
            <span>💭 班員の意見 ({opinionsList.length} 件)</span>
            <span>{expanded ? "▲" : "▼"}</span>
          </button>
          {expanded && (
            <div className="px-3 pb-3 space-y-2">
              {opinionsList.map((op) => (
                <div key={op.id} className="bg-slate-800/70 rounded-lg p-2.5 mt-2 border border-slate-700/40">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-blue-400 text-xs font-medium">{op.userName}</span>
                    <span className="text-slate-500 text-xs">{op.time}</span>
                  </div>
                  <p className="text-slate-200 text-sm whitespace-pre-wrap leading-relaxed mb-1.5">{op.text}</p>
                  <div className="flex gap-3 text-xs">
                    <span className="text-blue-300">👍 {op.likes?.length || 0}</span>
                    <span className="text-purple-300">❓ {op.questions?.length || 0}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Officer Room ─────────────────────────────────────────────────────────────
function OfficerRoom({ user, session, onLogout, onQR }) {
  const cd = useCountdown(session.timer);
  const { announcements, question, answers, opinions, started } = session;
  const [text, setText]   = useState("");
  const [mode, setMode]   = useState("announce");
  const [tab, setTab]     = useState("control");
  const [mins, setMins]   = useState("5");
  const [secs, setSecs]   = useState("0");

  const isMayor       = user.id === "mayor";
  const answeredCount = Object.keys(answers || {}).length;
  const totalGroups   = GROUP_NAMES.length;

  const handleTimer = async () => {
    if (cd.isRunning) await timerStop(cd.target - cd.rem, cd.target);
    else              await timerStart(cd.target - cd.rem, cd.target);
  };
  const handleSetTimer = async () => {
    const total = (parseInt(mins, 10) || 0) * 60 + (parseInt(secs, 10) || 0);
    if (total > 0) await timerSet(total);
  };
  const handleSend = async () => {
    if (!text.trim()) return;
    if (mode === "announce") {
      await addAnnouncement({ id: uid(), from: user.name, text: text.trim(), time: nowTime() });
    } else {
      await setQuestion({ id: uid(), text: text.trim(), time: nowTime() });
    }
    setText("");
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950">
      <header className="px-4 py-3 flex items-center justify-between sticky top-0 z-10 border-b border-amber-900/30"
        style={{ background: "rgba(12,8,0,0.97)", backdropFilter: "blur(12px)" }}>
        <div><div className="text-xs text-amber-600">{user.title}</div><div className="font-bold text-amber-200">{user.name}</div></div>
        <div className="flex items-center gap-2"><TimerBadge {...cd} /><QRBtn onQR={onQR} /><button onClick={onLogout} className="text-slate-600 text-xs">退室</button></div>
      </header>
      <div className={`text-center py-2 text-sm font-semibold border-b ${started ? "bg-emerald-950/40 text-emerald-300 border-emerald-900/40" : "bg-slate-900 text-slate-500 border-slate-800"}`}>
        {started ? "🟢 大会進行中" : "🔴 大会開始前"}
      </div>
      <div className="flex border-b border-slate-800">
        {[["control","操作"],["answers",`回答 ${answeredCount}/${totalGroups}`]].map(([k,l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex-1 py-3 text-sm font-semibold ${tab === k ? "text-amber-400 border-b-2 border-amber-400" : "text-slate-500"}`}>{l}</button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {tab === "control" && (
          <div className="space-y-4">
            {isMayor && (
              <Panel title="🎯 大会コントロール（市長のみ）">
                <button onClick={() => setSessionStart(!started)}
                  className={`w-full py-4 rounded-xl font-bold text-xl active:scale-95 ${started ? "bg-red-700 hover:bg-red-600" : "bg-emerald-700 hover:bg-emerald-600"}`}>
                  {started ? "⏹ 大会を終了する" : "▶ 大会をスタートする"}
                </button>
                <p className="text-slate-600 text-xs text-center mt-2">{started ? "市民の画面で回答が可能になっています" : "スタートするまで市民は回答できません"}</p>
              </Panel>
            )}
            <Panel title="⏱ カウントダウンタイマー（全員の画面に同期）">
              <div className="flex items-end gap-2 mb-3">
                <div className="flex-1"><label className="text-slate-600 text-xs mb-1 block">分</label>
                  <input type="number" value={mins} onChange={(e) => setMins(e.target.value)} min="0" max="99"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-center font-bold text-lg outline-none focus:border-amber-500" /></div>
                <div className="text-slate-500 font-bold pb-2">:</div>
                <div className="flex-1"><label className="text-slate-600 text-xs mb-1 block">秒</label>
                  <input type="number" value={secs} onChange={(e) => setSecs(e.target.value)} min="0" max="59"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-center font-bold text-lg outline-none focus:border-amber-500" /></div>
                <button onClick={handleSetTimer}
                  className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 rounded-lg font-bold text-slate-900 active:scale-95">セット</button>
              </div>
              <div className="flex gap-2">
                <button onClick={handleTimer} disabled={!cd.target}
                  className={`flex-1 py-3 rounded-xl font-bold text-lg active:scale-95 disabled:opacity-30 ${cd.isRunning ? "bg-red-700 hover:bg-red-600" : "bg-emerald-700 hover:bg-emerald-600"}`}>
                  {cd.isRunning ? "⏸ 一時停止" : "▶ スタート"}
                </button>
                <button onClick={() => timerReset(cd.target)} disabled={!cd.target}
                  className="px-5 py-3 bg-slate-800 hover:bg-slate-700 rounded-xl font-bold text-xl border border-slate-700 disabled:opacity-30">↺</button>
              </div>
              {cd.isTimeUp && <div className="mt-3 text-center py-2 bg-red-950 border border-red-800 rounded-xl text-red-400 font-bold animate-pulse">⏰ 時間終了！</div>}
            </Panel>
            {question && (<div className="rounded-xl p-3 border border-blue-700/30" style={{ background: "rgba(30,58,138,0.15)" }}>
              <div className="text-blue-400 text-xs font-semibold mb-1">現在の議題</div><p className="text-white text-sm">{question.text}</p></div>)}
            <Panel title="送信">
              <div className="flex mb-3 bg-slate-900 rounded-xl p-1 border border-slate-800">
                {[["announce","📢 アナウンス"],["question","❓ 議題"]].map(([k,l]) => (
                  <button key={k} onClick={() => setMode(k)}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold ${mode === k ? (k === "announce" ? "text-slate-900" : "text-white") : "text-slate-500"}`}
                    style={mode === k ? { background: k === "announce" ? "linear-gradient(135deg,#d97706,#f59e0b)" : "linear-gradient(135deg,#1e3a8a,#1d4ed8)" } : {}}>{l}</button>
                ))}
              </div>
              <textarea value={text} onChange={(e) => setText(e.target.value)}
                placeholder={mode === "announce" ? "全員へのアナウンスを入力..." : "議題を入力（送信で全班の回答・意見がリセット）..."}
                rows={3} className="w-full bg-slate-900 border border-slate-700 focus:border-amber-600 rounded-xl p-3 text-white placeholder-slate-600 text-sm resize-none outline-none" />
              <button onClick={handleSend} disabled={!text.trim()}
                className="mt-2 w-full py-3 rounded-xl font-bold active:scale-95 disabled:opacity-30"
                style={{ background: mode === "announce" ? "linear-gradient(135deg,#d97706,#f59e0b)" : "linear-gradient(135deg,#1e3a8a,#1d4ed8)", color: mode === "announce" ? "#1e293b" : "white" }}>送信する</button>
            </Panel>
            {announcements?.length > 0 && (
              <div><p className="text-slate-600 text-xs mb-2">送信済みアナウンス</p>
                {[...announcements].reverse().map((a) => (
                  <div key={a.id} className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 mb-1">
                    <span className="text-amber-500 text-xs mr-2">{a.time}</span><span className="text-slate-300 text-sm">{a.text}</span>
                  </div>
                ))}
              </div>
            )}
            {isMayor && (
              <button onClick={resetSession} className="w-full py-2 rounded-xl text-slate-600 text-xs border border-slate-800 hover:border-red-900/50 hover:text-red-500">
                ⚠ セッション全体をリセット
              </button>
            )}
          </div>
        )}
        {tab === "answers" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="bg-slate-900 rounded-xl p-3 text-center border border-emerald-900/30"><div className="text-2xl font-black text-emerald-400">{answeredCount}</div><div className="text-slate-500 text-xs">提出済み</div></div>
              <div className="bg-slate-900 rounded-xl p-3 text-center border border-slate-800"><div className="text-2xl font-black text-slate-500">{totalGroups - answeredCount}</div><div className="text-slate-500 text-xs">未提出</div></div>
            </div>
            {question && (<div className="rounded-xl p-3 border border-blue-700/30 mb-1" style={{ background: "rgba(30,58,138,0.15)" }}>
              <div className="text-blue-400 text-xs font-semibold mb-1">現在の議題</div><p className="text-white text-sm">{question.text}</p></div>)}
            {GROUP_NAMES.map((g, i) => (
              <GroupDetailCard key={g} groupIdx={i} answer={answers?.[String(i)]} opinionsMap={opinions?.[String(i)]} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Teacher Room ─────────────────────────────────────────────────────────────
function TeacherRoom({ session, onLogout, onQR }) {
  const cd = useCountdown(session.timer);
  const { announcements, question, answers, opinions, started } = session;
  const [tab, setTab] = useState("answers");
  const answeredCount = Object.keys(answers || {}).length;
  const totalGroups = GROUP_NAMES.length;

  return (
    <div className="min-h-screen flex flex-col bg-slate-950">
      <header className="px-4 py-3 flex items-center justify-between sticky top-0 z-10 border-b border-emerald-900/30"
        style={{ background: "rgba(2,14,10,0.97)", backdropFilter: "blur(12px)" }}>
        <div className="font-bold text-emerald-300">📋 教師</div>
        <div className="flex items-center gap-2"><TimerBadge {...cd} /><QRBtn onQR={onQR} /><button onClick={onLogout} className="text-slate-600 text-xs">退出</button></div>
      </header>
      <div className={`text-center py-2 text-sm font-semibold border-b ${started ? "bg-emerald-950/40 text-emerald-300 border-emerald-900/40" : "bg-slate-900 text-slate-500 border-slate-800"}`}>
        {started ? "🟢 大会進行中" : "🔴 大会開始前"}
      </div>
      <div className="flex border-b border-slate-800">
        {[["answers",`回答 ${answeredCount}/${totalGroups}`],["announce","連絡"]].map(([k,l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex-1 py-3 text-sm font-semibold ${tab === k ? "text-emerald-400 border-b-2 border-emerald-400" : "text-slate-500"}`}>{l}</button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {tab === "answers" && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 mb-2">
              {[
                { l: "提出済み", v: answeredCount, c: "text-emerald-400", b: "border-emerald-900/30" },
                { l: "未提出", v: totalGroups - answeredCount, c: "text-slate-500", b: "border-slate-800" },
                { l: cd.isTimeUp ? "TIME UP" : cd.isRunning ? "計測中" : "停止中", v: cd.isTimeUp ? "🔔" : cd.isRunning ? "●" : "■", c: cd.isTimeUp ? "text-red-400" : cd.isRunning ? "text-emerald-400" : "text-slate-500", b: "border-slate-800" },
              ].map((s) => (
                <div key={s.l} className={`bg-slate-900 rounded-xl p-3 text-center border ${s.b}`}>
                  <div className={`text-2xl font-black ${s.c}`}>{s.v}</div><div className="text-slate-500 text-xs mt-0.5">{s.l}</div>
                </div>
              ))}
            </div>
            {question && (<div className="rounded-xl p-3 border border-blue-700/30" style={{ background: "rgba(30,58,138,0.15)" }}>
              <div className="text-blue-400 text-xs font-semibold mb-1">現在の議題</div><p className="text-white">{question.text}</p></div>)}
            {GROUP_NAMES.map((g, i) => (
              <GroupDetailCard key={g} groupIdx={i} answer={answers?.[String(i)]} opinionsMap={opinions?.[String(i)]} />
            ))}
          </div>
        )}
        {tab === "announce" && (
          <div className="space-y-2">
            {!announcements?.length ? <div className="text-center py-20 text-slate-600">アナウンスはまだありません</div>
              : [...announcements].reverse().map((a) => (
                  <div key={a.id} className="rounded-xl p-3 border border-amber-900/30" style={{ background: "rgba(120,53,15,0.1)" }}>
                    <div className="flex items-center gap-2 mb-1"><span className="text-amber-400 text-xs font-semibold">📢 {a.from}</span><span className="text-slate-500 text-xs">{a.time}</span></div>
                    <p className="text-white text-sm">{a.text}</p>
                  </div>
                ))
            }
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Shared ───────────────────────────────────────────────────────────────────
function Field({ label, children }) {
  return <div><label className="text-slate-400 text-xs mb-1.5 block tracking-wider">{label}</label>{children}</div>;
}
function Panel({ title, children }) {
  return <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800"><p className="text-slate-500 text-xs mb-3 tracking-wide">{title}</p>{children}</div>;
}
