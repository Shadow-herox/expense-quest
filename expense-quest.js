import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAnalytics, isSupported } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  addDoc,
  updateDoc,
  serverTimestamp,
  runTransaction,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';
import { firebaseConfig } from './firebase-config.js';

const CATEGORIES = {
  Food: '🍔',
  Transport: '🚗',
  Shopping: '🛍️',
  Health: '💊',
  Entertainment: '🎮',
  Utilities: '⚡',
  Other: '📦',
};
const CAT_COLORS = {
  Food: '#f87171',
  Transport: '#fb923c',
  Shopping: '#a78bfa',
  Health: '#34d399',
  Entertainment: '#60a5fa',
  Utilities: '#fbbf24',
  Other: '#94a3b8',
};

const AVATAR_POOL = ['🐼', '🦁', '🦊', '🐯', '🦝', '🐧', '🐻', '🦉', '🐨', '🦄'];

const LOCKED_QUEST_TEMPLATES = [
  { title: 'Budget Beast', desc: 'Stay under budget for a full month', icon: '🏋️', reward: 500 },
  { title: 'Savings Guru', desc: 'Save 30% of income this month', icon: '🧘', reward: 400 },
];

/** Bootstrap data written to `achievements/{id}` once per id (display reads from Firestore only). */
const ACHIEVEMENT_SEED = [
  { id: 'first_receipt', order: 1, title: 'First Receipt', description: 'Upload your first receipt', icon: '🧾', condition: 'receipt_count >= 1', rewardXP: 50 },
  { id: 'streak_master', order: 2, title: 'Streak Master', description: 'Reach a 5-day logging streak', icon: '🔥', condition: 'streak >= 5', rewardXP: 100 },
  { id: 'category_explorer', order: 3, title: 'Category Explorer', description: 'Log spending in 5 different categories', icon: '🗺️', condition: 'categories >= 5', rewardXP: 120 },
  { id: 'saver', order: 4, title: 'Saver', description: 'Accumulate ₹5,000 in tracked savings', icon: '💰', condition: 'total_saved >= 5000', rewardXP: 150 },
  { id: 'quest_crusher', order: 5, title: 'Quest Crusher', description: 'Complete 3 quests', icon: '⚔️', condition: 'quests_completed >= 3', rewardXP: 200 },
  { id: 'consistency_king', order: 6, title: 'Consistency King', description: 'Log 7 days straight', icon: '👑', condition: 'streak >= 7', rewardXP: 250 },
];

function defaultQuestsForUser(uid) {
  return [
    {
      userId: uid,
      title: 'Frugal Week',
      desc: 'Record ₹5,000 in total spending (tracked from your receipts)',
      questType: 'spend_limit',
      target: 5000,
      progress: 0,
      reward: 200,
      completed: false,
      icon: '💰',
      color: '#22d3a0',
      locked: false,
      createdAt: serverTimestamp(),
    },
    {
      userId: uid,
      title: 'Receipt Hoarder',
      desc: 'Upload 10 receipts this month',
      questType: 'receipt_count',
      target: 10,
      progress: 0,
      reward: 150,
      completed: false,
      icon: '📸',
      color: '#7c6ef8',
      locked: false,
      createdAt: serverTimestamp(),
    },
    {
      userId: uid,
      title: 'Category Master',
      desc: 'Log ₹2,000 in Food spending',
      questType: 'category_spend',
      category: 'Food',
      target: 2000,
      progress: 0,
      reward: 100,
      completed: false,
      icon: '🗂️',
      color: '#f472b6',
      locked: false,
      createdAt: serverTimestamp(),
    },
    {
      userId: uid,
      title: 'Daily Logger',
      desc: 'Build a 5-day logging streak',
      questType: 'logging_streak',
      target: 5,
      progress: 0,
      reward: 120,
      completed: false,
      icon: '📅',
      color: '#fb923c',
      locked: false,
      createdAt: serverTimestamp(),
    },
  ];
}

function isConfigReady() {
  return firebaseConfig.apiKey && !String(firebaseConfig.apiKey).includes('YOUR_');
}

function levelFromXp(xp) {
  return Math.min(99, Math.max(1, Math.floor((xp || 0) / 350) + 1));
}

function xpIntoLevel(xp) {
  const lv = levelFromXp(xp);
  const minXp = (lv - 1) * 350;
  const maxXp = lv * 350;
  const pct = Math.min(100, Math.round(((xp - minXp) / (maxXp - minXp)) * 100));
  return { level: lv, pct: Number.isFinite(pct) ? pct : 0 };
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function pickAvatar(seed) {
  const s = String(seed || '').length;
  return AVATAR_POOL[s % AVATAR_POOL.length];
}

let app;
let analytics = null;
let auth;
let db;
let storage;
let googleProvider;

let currentUser = null;
let unsubLeaderboard = null;
let unsubQuests = null;
let unsubReceipts = null;
let unsubUser = null;
let unsubAchievementsMaster = null;
let unsubUserAchievements = null;
let receiptsCache = [];
let questsCache = [];
let leaderboardCache = [];
let achievementsMasterList = [];
let userUnlockedAchievementIds = new Set();
let userStatsCache = {};
let lastKnownRank = null;
let spendChart = null;
let catChart = null;

function $(id) {
  return document.getElementById(id);
}

function showToast(icon, title, sub) {
  const t = $('toast');
  $('toastIcon').textContent = icon;
  $('toastTitle').textContent = title;
  $('toastSub').textContent = sub;
  t.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove('show'), 3200);
}

function spawnConfetti() {
  const colors = ['#7c6ef8', '#22d3a0', '#f472b6', '#fbbf24', '#60a5fa'];
  for (let i = 0; i < 12; i++) {
    const d = document.createElement('div');
    d.className = 'confetti-bit';
    d.style.left = `${30 + Math.random() * 40}vw`;
    d.style.bottom = '4rem';
    d.style.background = colors[Math.floor(Math.random() * colors.length)];
    d.style.animationDelay = `${Math.random() * 0.4}s`;
    d.style.transform = `rotate(${Math.random() * 360}deg)`;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 1600);
  }
}

async function rewardXP(uid, amount) {
  const userRef = doc(db, 'users', uid);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(userRef);
    const cur = snap.exists() ? snap.data().xp || 0 : 0;
    const next = cur + amount;
    tx.set(
      userRef,
      {
        xp: next,
        level: levelFromXp(next),
      },
      { merge: true }
    );
  });
}

async function ensureUserProfile(user) {
  const userRef = doc(db, 'users', user.uid);
  const snap = await getDoc(userRef);
  const statsDefaults = {
    totalReceipts: 0,
    totalSaved: 0,
    categoriesUsed: [],
    questsCompleted: 0,
  };
  if (!snap.exists()) {
    await setDoc(userRef, {
      name: user.displayName || 'Player',
      email: user.email || '',
      xp: 0,
      level: 1,
      streak: 0,
      avatar: pickAvatar(user.uid),
      lastLogDate: null,
      createdAt: serverTimestamp(),
      ...statsDefaults,
    });
  } else {
    await setDoc(
      userRef,
      {
        name: user.displayName || snap.data().name || 'Player',
        email: user.email || snap.data().email || '',
        totalReceipts: snap.data().totalReceipts ?? 0,
        totalSaved: snap.data().totalSaved ?? 0,
        categoriesUsed: snap.data().categoriesUsed ?? [],
        questsCompleted: snap.data().questsCompleted ?? 0,
      },
      { merge: true }
    );
  }
}

async function ensureDefaultAchievements() {
  for (const row of ACHIEVEMENT_SEED) {
    const ref = doc(db, 'achievements', row.id);
    const ex = await getDoc(ref);
    if (ex.exists()) continue;
    const { id, ...rest } = row;
    await setDoc(ref, rest);
  }
}

async function ensureDefaultQuests(uid) {
  const qRef = collection(db, 'quests');
  const q = query(qRef, where('userId', '==', uid));
  const snap = await getDocs(q);
  if (!snap.empty) return;
  const batch = writeBatch(db);
  for (const template of defaultQuestsForUser(uid)) {
    const ref = doc(collection(db, 'quests'));
    batch.set(ref, template);
  }
  await batch.commit();
}

function detachListeners() {
  if (unsubLeaderboard) unsubLeaderboard();
  if (unsubQuests) unsubQuests();
  if (unsubReceipts) unsubReceipts();
  if (unsubUser) unsubUser();
  if (unsubAchievementsMaster) unsubAchievementsMaster();
  if (unsubUserAchievements) unsubUserAchievements();
  unsubLeaderboard =
    unsubQuests =
    unsubReceipts =
    unsubUser =
    unsubAchievementsMaster =
    unsubUserAchievements =
      null;
}

function updateNavAndGreeting(userDoc) {
  const xp = userDoc?.xp ?? 0;
  const streak = userDoc?.streak ?? 0;
  const { level, pct } = xpIntoLevel(xp);
  const fill = $('xpFill');
  if (fill) fill.style.width = `${pct}%`;
  const navLine = $('navXpMeta');
  if (navLine) {
    navLine.textContent = `Level ${level} · ${xp.toLocaleString()} XP`;
  }
  const badge = $('navLevelBadge');
  if (badge) badge.textContent = String(level);

  const greet = $('dashGreet');
  if (greet) {
    const name = (userDoc?.name || currentUser?.displayName || 'there').split(' ')[0];
    greet.textContent = `Good morning, ${name} 👋`;
  }
  const sub = $('dashSub');
  if (sub) {
    sub.textContent =
      streak > 0
        ? `You're on a ${streak}-day streak! Keep logging to earn XP.`
        : 'Upload a receipt to start your streak and earn XP.';
  }
  const streakPill = $('dashStreakPill');
  if (streakPill) {
    streakPill.textContent = streak > 0 ? `🔥 ${streak}-day streak` : '🔥 Start your streak';
  }
}

function computeRank(leaderboardRows, uid) {
  const idx = leaderboardRows.findIndex((r) => r.id === uid);
  return idx === -1 ? null : idx + 1;
}

function updateRankPill(rank) {
  const el = $('dashRankPill');
  if (!el) return;
  if (rank == null) {
    el.textContent = '⚡ —';
    return;
  }
  el.textContent = `⚡ Rank #${rank}`;
}

function renderPodium(top3, myUid) {
  const order = [top3[1], top3[0], top3[2]].filter(Boolean);
  const wrap = $('podium');
  if (!wrap) return;

  const heights = [100, 120, 90];
  const widths = [110, 120, 100];
  const medals = ['#c0c0c0', '#ffd700', '#cd7f32'];
  const ranks = [2, 1, 3];

  wrap.innerHTML = order
    .map((p, i) => {
      const isMe = p.id === myUid;
      const rank = ranks[i];
      const h = heights[i];
      const w = widths[i];
      const border =
        rank === 1 ? '2px solid #ffd700' : '1px solid var(--border)';
      const crown = rank === 1 ? `<div style="position:absolute;top:-14px;font-size:1.4rem;">👑</div>` : '';
      const name = isMe ? `${p.name || 'You'} (You)` : (p.name || 'Player');
      return `
      <div style="text-align:center;">
        <div style="background:var(--card);border:${border};border-radius:var(--radius);padding:1rem;width:${w}px;height:${h}px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;position:relative;">
          ${crown}
          <div style="font-size:${rank === 1 ? '2rem' : '1.8rem'};margin-bottom:4px;">${p.avatar || '🙂'}</div>
          <div style="font-size:0.8rem;font-weight:500;">${escapeHtml(name)}</div>
          <div style="font-size:0.7rem;color:var(--muted)">${(p.xp || 0).toLocaleString()} XP</div>
        </div>
        <div style="margin-top:0.5rem;font-size:${rank === 1 ? '1.1rem' : '1rem'};color:${medals[i]};font-weight:700;font-family:'Space Grotesk',sans-serif;">#${rank}</div>
      </div>`;
    })
    .join('');

  if (order.length === 0) {
    wrap.innerHTML =
      '<p class="empty-state" style="padding:1rem;">No players yet. Be the first to earn XP!</p>';
  }
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function parseAchievementCondition(condition) {
  const m = String(condition || '').trim().match(/^(\w+)\s*(>=|<=|==|>|<)\s*(\d+)$/);
  if (!m) return null;
  return { metric: m[1], op: m[2], target: Number(m[3]) };
}

function statsValueForMetric(metric, stats) {
  switch (metric) {
    case 'receipt_count':
      return Number(stats.totalReceipts) || 0;
    case 'streak':
      return Number(stats.streak) || 0;
    case 'categories':
      return Array.isArray(stats.categoriesUsed) ? stats.categoriesUsed.length : 0;
    case 'total_saved':
      return Number(stats.totalSaved) || 0;
    case 'quests_completed':
      return Number(stats.questsCompleted) || 0;
    default:
      return 0;
  }
}

function achievementConditionMet(condition, stats) {
  const p = parseAchievementCondition(condition);
  if (!p) return false;
  const v = statsValueForMetric(p.metric, stats);
  const t = p.target;
  switch (p.op) {
    case '>=':
      return v >= t;
    case '<=':
      return v <= t;
    case '>':
      return v > t;
    case '<':
      return v < t;
    case '==':
      return v === t;
    default:
      return false;
  }
}

function achievementProgressPreview(achievement, stats) {
  const p = parseAchievementCondition(achievement.condition);
  if (!p) return null;
  const cur = statsValueForMetric(p.metric, stats);
  const target = p.target;
  const capped = Math.min(cur, target);
  const pct = target > 0 ? Math.round((capped / target) * 100) : 0;
  let hint = `${cur} / ${target}`;
  if (p.metric === 'receipt_count') hint = `${cur}/${target} receipts`;
  if (p.metric === 'streak') hint = `${cur}/${target} day streak`;
  if (p.metric === 'categories') hint = `${cur}/${target} categories`;
  if (p.metric === 'total_saved') hint = `₹${cur.toLocaleString()} / ₹${target.toLocaleString()} saved`;
  if (p.metric === 'quests_completed') hint = `${cur}/${target} quests done`;
  return { pct, hint };
}

async function syncUserStats(uid) {
  const userRef = doc(db, 'users', uid);
  const rSnap = await getDocs(collection(db, 'users', uid, 'receipts'));
  const categoriesUsed = [];
  const seen = new Set();
  let totalSaved = 0;
  rSnap.forEach((d) => {
    const x = d.data();
    const c = x.category || x.cat;
    if (c && !seen.has(c)) {
      seen.add(c);
      categoriesUsed.push(c);
    }
    totalSaved += Number(x.savedContribution) || 0;
  });
  const qSnap = await getDocs(query(collection(db, 'quests'), where('userId', '==', uid)));
  let questsCompleted = 0;
  qSnap.forEach((d) => {
    if (d.data().completed) questsCompleted += 1;
  });
  await updateDoc(userRef, {
    totalReceipts: rSnap.size,
    categoriesUsed,
    totalSaved,
    questsCompleted,
  });
}

async function tryUnlockAchievement(uid, achievement) {
  const ref = doc(db, 'userAchievements', `${uid}_${achievement.id}`);
  const didUnlock = await runTransaction(db, async (tx) => {
    const ex = await tx.get(ref);
    if (ex.exists()) return false;
    tx.set(ref, {
      userId: uid,
      achievementId: achievement.id,
      unlocked: true,
      unlockedAt: serverTimestamp(),
    });
    return true;
  });
  if (!didUnlock) return;
  const xpReward = Number(achievement.rewardXP) || 0;
  await rewardXP(uid, xpReward);
  showToast('🏆', 'Achievement Unlocked!', `${achievement.title} · +${xpReward} XP`);
  spawnConfetti();
}

async function runAchievementCheck(uid) {
  const userSnap = await getDoc(doc(db, 'users', uid));
  if (!userSnap.exists()) return;
  const d = userSnap.data();
  const stats = {
    totalReceipts: d.totalReceipts ?? 0,
    streak: d.streak ?? 0,
    categoriesUsed: d.categoriesUsed ?? [],
    totalSaved: d.totalSaved ?? 0,
    questsCompleted: d.questsCompleted ?? 0,
  };
  const masterSnap = await getDocs(collection(db, 'achievements'));
  const list = [];
  masterSnap.forEach((docSnap) => list.push({ id: docSnap.id, ...docSnap.data() }));
  list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const ach of list) {
    if (!achievementConditionMet(ach.condition, stats)) continue;
    await tryUnlockAchievement(uid, ach);
  }
}

async function postUserMutation(uid) {
  await syncUserStats(uid);
  await runAchievementCheck(uid);
}

function renderLeaderboard(rows) {
  const el = $('lbList');
  if (!el) return;
  const myUid = currentUser?.uid;
  const sorted = [...rows].sort((a, b) => (b.xp || 0) - (a.xp || 0));

  const rank = computeRank(sorted, myUid);
  updateRankPill(rank);

  if (lastKnownRank != null && rank != null && rank < lastKnownRank) {
    showToast('🔥', 'You moved up!', `New rank: #${rank}`);
  }
  if (rank != null) lastKnownRank = rank;

  const top3 = [sorted[0], sorted[1], sorted[2]];
  renderPodium(top3, myUid);

  el.innerHTML = sorted
    .map((p, index) => {
      const r = index + 1;
      const isMe = p.id === myUid;
      const medal = r <= 3 ? ['🥇', '🥈', '🥉'][r - 1] : String(r);
      const rankClass = r <= 3 ? `rank-${r}` : '';
      return `
      <div class="lb-row ${isMe ? 'lb-row-me' : ''}" data-user="${escapeHtml(p.id)}">
        <div class="lb-rank ${rankClass}">${medal}</div>
        <div class="avatar" style="background:var(--bg3);font-size:1.3rem;${isMe ? 'border-color:var(--accent);border-width:2px;' : ''}">${p.avatar || '🙂'}</div>
        <div class="lb-name">
          <div style="font-weight:500">${escapeHtml(p.name || 'Player')}${isMe ? ' <span class="pill pill-accent" style="margin-left:6px">You</span>' : ''}</div>
          <div class="lb-sub">🔥 ${p.streak ?? 0}-day streak</div>
        </div>
        <div class="lb-score">${(p.xp || 0).toLocaleString()} XP</div>
      </div>`;
    })
    .join('');
}

function questPercent(q) {
  if (q.completed) return 100;
  const t = Number(q.target) || 1;
  const p = Number(q.progress) || 0;
  if (q.questType === 'spend_limit') {
    return Math.min(100, Math.round((p / t) * 100));
  }
  return Math.min(100, Math.round((p / t) * 100));
}

function renderQuests(list) {
  const active = list.filter((q) => !q.locked);
  const el = $('questList');
  if (el) {
    el.innerHTML = active.length
      ? active
          .map((q) => {
            const pct = questPercent(q);
            const done = !!q.completed;
            return `
        <div class="quest-card" data-quest-id="${escapeHtml(q.id)}">
          <div class="quest-icon" style="background:${q.color || '#7c6ef8'}22">${q.icon || '⭐'}</div>
          <div class="quest-info">
            <div class="quest-title">${escapeHtml(q.title || '')}</div>
            <div class="quest-desc">${escapeHtml(q.desc || '')}</div>
            <div class="quest-progress"><div class="quest-fill" style="width:${pct}%;background:${q.color || '#7c6ef8'}"></div></div>
            <div style="font-size:0.72rem;color:var(--muted);margin-top:4px">${pct}% complete</div>
          </div>
          <div class="quest-reward">
            ${done ? '<span class="badge-done">✓ Done</span>' : `+${q.reward ?? 0} XP`}
          </div>
        </div>`;
          })
          .join('')
      : '<div class="empty-state"><div class="empty-icon">📜</div>No active quests yet.</div>';
  }

  const lockedEl = $('lockedQuests');
  if (lockedEl) {
    lockedEl.innerHTML = LOCKED_QUEST_TEMPLATES.map(
      (q) => `
      <div class="quest-card" style="opacity:0.4;">
        <div class="quest-icon" style="background:var(--bg3)">🔒</div>
        <div class="quest-info">
          <div class="quest-title">${escapeHtml(q.title)}</div>
          <div class="quest-desc">${escapeHtml(q.desc)}</div>
        </div>
        <div class="quest-reward">+${q.reward} XP</div>
      </div>`
    ).join('');
  }
}

function renderRecent(list) {
  const el = $('recentList');
  if (!el) return;
  const slice = list.slice(0, 8);
  el.innerHTML = slice.length
    ? slice
        .map((r) => {
          const cat = r.category || r.cat || 'Other';
          const emoji = r.emoji || CATEGORIES[cat] || '📦';
          const when = r.createdAt?.toDate
            ? r.createdAt.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
            : r.date || '';
          return `
      <div class="receipt-item">
        <div class="receipt-thumb">${r.thumbUrl ? `<img src="${escapeHtml(r.thumbUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:8px"/>` : emoji}</div>
        <div class="receipt-info">
          <div class="receipt-name">${escapeHtml(r.name || 'Receipt')}</div>
          <div class="receipt-meta">${when} <span class="tag" style="background:rgba(124,110,248,0.15);color:#a78bfa">${escapeHtml(cat)}</span></div>
        </div>
        <div class="receipt-amount">₹${Number(r.amount || 0).toLocaleString()}</div>
      </div>`;
        })
        .join('')
    : '<div class="empty-state"><div class="empty-icon">🧾</div>No receipts yet. Upload to earn XP!</div>';
}

function renderAchievementGrid() {
  const grid = $('achGrid');
  if (!grid) return;
  if (!isConfigReady() || !currentUser) {
    grid.innerHTML =
      '<div class="empty-state" style="grid-column:1/-1;padding:2rem 1rem;"><div class="empty-icon">🏆</div>Sign in with Firebase configured to load achievements.</div>';
    return;
  }
  if (!achievementsMasterList.length) {
    grid.innerHTML =
      '<div class="empty-state" style="grid-column:1/-1;"><div class="empty-icon">⏳</div>Loading achievements…</div>';
    return;
  }
  const stats = {
    totalReceipts: userStatsCache.totalReceipts ?? 0,
    streak: userStatsCache.streak ?? 0,
    categoriesUsed: userStatsCache.categoriesUsed ?? [],
    totalSaved: userStatsCache.totalSaved ?? 0,
    questsCompleted: userStatsCache.questsCompleted ?? 0,
  };
  grid.innerHTML = achievementsMasterList
    .map((a) => {
      const unlocked = userUnlockedAchievementIds.has(a.id);
      const preview = !unlocked ? achievementProgressPreview(a, stats) : null;
      const cardClass = unlocked ? 'ach-card unlocked' : 'ach-card locked';
      const progBlock =
        !unlocked && preview
          ? `<div class="ach-progress"><div class="ach-progress-fill" style="width:${preview.pct}%"></div></div>
             <div class="ach-progress-label">${escapeHtml(preview.hint)}</div>`
          : '';
      return `
    <div class="${cardClass}" data-achievement-id="${escapeHtml(a.id)}">
      ${unlocked ? '<span class="ach-unlocked-badge">✓</span>' : '<div class="ach-lock-overlay" aria-hidden="true">🔒</div>'}
      <div class="ach-icon">${a.icon || '⭐'}</div>
      <div class="ach-name">${escapeHtml(a.title || '')}</div>
      <div class="ach-desc">${escapeHtml(a.description || '')}</div>
      <span class="ach-xp-pill">+${Number(a.rewardXP) || 0} XP</span>
      ${progBlock}
    </div>`;
    })
    .join('');
}

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function aggregateReceipts(receipts) {
  const byCat = {};
  const byMonth = {};
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    byMonth[monthKey(d)] = 0;
  }
  let monthTotal = 0;
  const curMonth = monthKey(now);

  receipts.forEach((r) => {
    const amt = Number(r.amount) || 0;
    const cat = r.category || r.cat || 'Other';
    byCat[cat] = (byCat[cat] || 0) + amt;
    const cd = r.createdAt?.toDate ? r.createdAt.toDate() : null;
    if (cd) {
      const mk = monthKey(cd);
      if (byMonth[mk] !== undefined) byMonth[mk] += amt;
      if (mk === curMonth) monthTotal += amt;
    }
  });

  return { byCat, byMonth, monthTotal, receiptCount: receipts.length };
}

function destroyCharts() {
  if (spendChart) {
    spendChart.destroy();
    spendChart = null;
  }
  if (catChart) {
    catChart.destroy();
    catChart = null;
  }
}

function initOrRefreshCharts(receipts) {
  const spendCanvas = $('spendChart');
  const catCanvas = $('catChart');
  if (!spendCanvas || !catCanvas || typeof Chart === 'undefined') return;

  const { byCat, byMonth } = aggregateReceipts(receipts);
  const monthLabels = Object.keys(byMonth).map((k) => {
    const [y, m] = k.split('-');
    const d = new Date(Number(y), Number(m) - 1, 1);
    return d.toLocaleString('en', { month: 'short' });
  });
  const monthVals = Object.values(byMonth);

  destroyCharts();
  const lastIdx = monthVals.length - 1;
  spendChart = new Chart(spendCanvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: monthLabels,
      datasets: [
        {
          data: monthVals,
          backgroundColor: monthVals.map((_, i) => (i === lastIdx ? '#7c6ef8' : 'rgba(124,110,248,0.3)')),
          borderRadius: 6,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#8888aa', font: { size: 11 } } },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: {
            color: '#8888aa',
            font: { size: 11 },
            callback: (v) => '₹' + v / 1000 + 'k',
          },
        },
      },
    },
  });

  const cats = Object.keys(CATEGORIES);
  const catVals = cats.map((c) => byCat[c] || 0);
  catChart = new Chart(catCanvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: cats,
      datasets: [
        {
          data: catVals,
          backgroundColor: cats.map((c) => CAT_COLORS[c]),
          borderWidth: 0,
          hoverOffset: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: '#8888aa', font: { size: 11 }, padding: 12, boxWidth: 10 } },
      },
      cutout: '68%',
    },
  });
}

function updateDashboardStats(userDoc, receipts) {
  const { monthTotal, receiptCount, byMonth } = aggregateReceipts(receipts);
  const keys = Object.keys(byMonth);
  const curKey = keys[keys.length - 1];
  const prevKey = keys[keys.length - 2];
  const cur = byMonth[curKey] || 0;
  const prev = byMonth[prevKey] || 0;
  const delta = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : 0;

  const monthEl = $('statMonth');
  if (monthEl) monthEl.textContent = `₹${monthTotal.toLocaleString()}`;
  const deltaEl = $('statMonthDelta');
  if (deltaEl) {
    deltaEl.textContent = prev ? `${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta)}% vs last month` : '—';
    deltaEl.className = `stat-delta ${delta >= 0 ? 'up' : 'down'}`;
  }

  const xp = userDoc?.xp ?? 0;
  const sx = $('statXp');
  if (sx) sx.textContent = xp.toLocaleString();

  const rc = $('statReceipts');
  if (rc) rc.textContent = String(receiptCount);

  const saved = $('statSaved');
  if (saved) {
    const ts = userDoc?.totalSaved;
    if (ts != null && ts > 0) {
      saved.textContent = `₹${Number(ts).toLocaleString()}`;
      saved.style.color = 'var(--green)';
    } else {
      saved.textContent = '₹0';
      saved.style.color = 'var(--muted)';
    }
  }
}

async function completeQuest(questRef, quest, uid) {
  if (quest.completed) return;
  await updateDoc(questRef, { completed: true });
  const bonus = Number(quest.reward) || 0;
  await rewardXP(uid, bonus);
  showToast('🎉', 'Quest Completed!', `${quest.title || 'Quest'} · +${bonus} XP`);
  spawnConfetti();
}

async function syncLoggingStreakQuests(uid) {
  const userSnap = await getDoc(doc(db, 'users', uid));
  const st = userSnap.exists() ? userSnap.data().streak || 0 : 0;
  const qq = query(collection(db, 'quests'), where('userId', '==', uid));
  const snap = await getDocs(qq);
  for (const d of snap.docs) {
    const quest = { id: d.id, ...d.data() };
    if (quest.questType !== 'logging_streak' || quest.completed || quest.locked) continue;
    const target = Number(quest.target) || 1;
    await updateDoc(d.ref, { progress: st });
    if (st >= target) await completeQuest(d.ref, { ...quest, progress: st }, uid);
  }
}

async function updateQuestProgressFromReceipt(uid, receipt) {
  const qq = query(collection(db, 'quests'), where('userId', '==', uid));
  const snap = await getDocs(qq);
  const cat = receipt.category || receipt.cat;
  const amount = Number(receipt.amount) || 0;

  for (const d of snap.docs) {
    const quest = { id: d.id, ...d.data() };
    if (quest.completed || quest.locked) continue;
    if (quest.questType === 'logging_streak') continue;

    let newProgress = Number(quest.progress) || 0;
    let shouldComplete = false;

    switch (quest.questType) {
      case 'category_spend':
        if (cat === quest.category) newProgress += amount;
        shouldComplete = newProgress >= Number(quest.target);
        break;
      case 'receipt_count':
        newProgress += 1;
        shouldComplete = newProgress >= Number(quest.target);
        break;
      case 'spend_limit':
        newProgress += amount;
        shouldComplete = newProgress >= Number(quest.target);
        break;
      default:
        break;
    }

    const prev = Number(quest.progress) || 0;
    if (newProgress === prev && quest.questType !== 'receipt_count') continue;
    await updateDoc(d.ref, { progress: newProgress });
    if (shouldComplete) {
      await completeQuest(d.ref, { ...quest, progress: newProgress }, uid);
    }
  }
}

async function updateStreakOnReceipt(uid) {
  const userRef = doc(db, 'users', uid);
  const day = todayKey();
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists()) return;
    const data = snap.data();
    const last = data.lastLogDate || null;
    let streak = data.streak || 0;
    if (last === day) {
      return;
    }
    if (!last) {
      streak = 1;
    } else {
      const prev = new Date(last + 'T12:00:00');
      const y = new Date(day + 'T12:00:00');
      const diffDays = Math.round((y - prev) / (86400 * 1000));
      streak = diffDays === 1 ? streak + 1 : 1;
    }
    tx.update(userRef, { lastLogDate: day, streak });
  });
}

function onDrag(e, over) {
  e.preventDefault();
  $('dropZone')?.classList.toggle('drag', over);
}

function onDrop(e) {
  e.preventDefault();
  onDrag(e, false);
  handleFiles(e.dataTransfer.files);
}

async function handleFiles(fileList) {
  if (!currentUser) {
    showToast('🔐', 'Sign in required', 'Use Google Sign-In to upload receipts.');
    return;
  }
  const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;

  const previews = $('uploadedPreviews');
  const uid = currentUser.uid;

  for (let idx = 0; idx < files.length; idx++) {
    const file = files[idx];
    const url = URL.createObjectURL(file);
    if (previews) {
      previews.innerHTML += `<div style="position:relative;border-radius:var(--radius-sm);overflow:hidden;aspect-ratio:1;background:var(--bg3);">
      <img src="${url}" style="width:100%;height:100%;object-fit:cover;" alt="" />
      <div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,0.7));padding:0.5rem;font-size:0.72rem;">${escapeHtml(file.name.slice(0, 18))}</div>
    </div>`;
    }

    const run = async () => {
      const cats = Object.keys(CATEGORIES);
      const category = cats[Math.floor(Math.random() * cats.length)];
      const amount = Math.floor(Math.random() * 2000) + 100;
      const name = file.name.replace(/\.[^.]+$/, '');
      const rid = doc(collection(db, 'users', uid, 'receipts')).id;
      const storageRef = ref(storage, `receipts/${uid}/${rid}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
      await uploadBytes(storageRef, file);
      const imageUrl = await getDownloadURL(storageRef);

      await updateStreakOnReceipt(uid);
      await syncLoggingStreakQuests(uid);

      const savedContribution = Math.min(800, Math.round(amount * 0.12));

      await addDoc(collection(db, 'users', uid, 'receipts'), {
        name,
        amount,
        category,
        cat: category,
        emoji: CATEGORIES[category],
        xp: 50,
        thumbUrl: imageUrl,
        savedContribution,
        createdAt: serverTimestamp(),
      });

      await rewardXP(uid, 50);
      await updateQuestProgressFromReceipt(uid, { amount, category, cat: category });
      showToast('⚡', '+50 XP', `${name} · ${category}`);
      spawnConfetti();
      await postUserMutation(uid);
    };

    setTimeout(() => {
      run().catch((err) => {
        console.error(err);
        showToast('⚠️', 'Upload failed', err.message || 'Check Firebase rules & Storage.');
      });
    }, 600 + idx * 200);
  }
}

function showPage(id) {
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  $(`page-${id}`)?.classList.add('active');
  document.querySelectorAll('.tab').forEach((t) => {
    if (t.textContent.toLowerCase().includes(id)) t.classList.add('active');
  });
}

function setAuthUi(user) {
  const out = $('authOut');
  const inBtn = $('authIn');
  const chip = $('userChip');
  const shell = $('appShell');
  const gate = $('authGate');

  if (!isConfigReady()) {
    if (out) out.style.display = 'none';
    if (inBtn) inBtn.style.display = 'none';
    if (chip) chip.style.display = 'none';
    shell?.classList.remove('app-locked');
    gate?.classList.add('hidden');
    return;
  }

  if (user) {
    if (out) out.style.display = '';
    if (inBtn) inBtn.style.display = 'none';
    if (chip) {
      chip.style.display = '';
      chip.textContent = user.displayName?.split(' ')[0] || 'Account';
    }
    shell?.classList.remove('app-locked');
    gate?.classList.add('hidden');
  } else {
    if (out) out.style.display = 'none';
    if (inBtn) inBtn.style.display = '';
    if (chip) chip.style.display = 'none';
    shell?.classList.add('app-locked');
    gate?.classList.remove('hidden');
  }
}

async function signInGoogle() {
  if (!isConfigReady()) {
    showToast('⚙️', 'Firebase config', 'Edit firebase-config.js with your project keys.');
    return;
  }
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (e) {
    console.error(e);
    showToast('⚠️', 'Sign-in failed', e.message || 'Try again');
  }
}

async function signOutApp() {
  await signOut(auth);
  lastKnownRank = null;
}

function wireUi() {
  window.showPage = showPage;
  window.onDrag = onDrag;
  window.onDrop = onDrop;
  window.handleFiles = (files) => handleFiles(files);
  $('authIn')?.addEventListener('click', signInGoogle);
  $('authOut')?.addEventListener('click', signOutApp);
  $('authInGate')?.addEventListener('click', signInGoogle);
}

function subscribeLeaderboard() {
  const q = query(collection(db, 'users'), orderBy('xp', 'desc'));
  unsubLeaderboard = onSnapshot(q, (snap) => {
    const rows = [];
    snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
    leaderboardCache = rows;
    renderLeaderboard(rows);
  });
}

function subscribeQuests(uid) {
  const qRef = query(collection(db, 'quests'), where('userId', '==', uid));
  unsubQuests = onSnapshot(qRef, (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    list.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
    questsCache = list;
    renderQuests(list);
  });
}

function subscribeReceipts(uid) {
  const rRef = query(collection(db, 'users', uid, 'receipts'), orderBy('createdAt', 'desc'));
  unsubReceipts = onSnapshot(
    rRef,
    (snap) => {
      const list = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
      receiptsCache = list;
      renderRecent(list);
      initOrRefreshCharts(list);
      getDoc(doc(db, 'users', uid)).then((us) => {
        if (us.exists()) updateDashboardStats(us.data(), list);
      });
    },
    (err) => {
      console.error(err);
      showToast('⚠️', 'Receipts sync', err.message || 'Firestore index may be required.');
    }
  );
}

function subscribeUserDoc(uid) {
  unsubUser = onSnapshot(doc(db, 'users', uid), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    userStatsCache = {
      totalReceipts: data.totalReceipts ?? 0,
      streak: data.streak ?? 0,
      categoriesUsed: data.categoriesUsed ?? [],
      totalSaved: data.totalSaved ?? 0,
      questsCompleted: data.questsCompleted ?? 0,
    };
    updateNavAndGreeting(data);
    updateDashboardStats(data, receiptsCache);
    renderAchievementGrid();
  });
}

function subscribeAchievementsMaster() {
  unsubAchievementsMaster = onSnapshot(collection(db, 'achievements'), (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    achievementsMasterList = list;
    renderAchievementGrid();
  });
}

function subscribeUserAchievements(uid) {
  const qRef = query(collection(db, 'userAchievements'), where('userId', '==', uid));
  unsubUserAchievements = onSnapshot(qRef, (snap) => {
    const ids = new Set();
    snap.forEach((d) => {
      const x = d.data();
      if (x.achievementId) ids.add(x.achievementId);
    });
    userUnlockedAchievementIds = ids;
    renderAchievementGrid();
  });
}

async function boot() {
  wireUi();
  renderAchievementGrid();

  if (!isConfigReady()) {
    setAuthUi(null);
    showToast('⚙️', 'Firebase', 'Add your keys in firebase-config.js to enable sync.');
    const lb = $('lbList');
    if (lb) {
      lb.innerHTML =
        '<div class="empty-state"><div class="empty-icon">🔧</div>Configure Firebase to load the live leaderboard.</div>';
    }
    initOrRefreshCharts([]);
    return;
  }

  app = initializeApp(firebaseConfig);
  isSupported()
    .then((ok) => {
      if (ok) analytics = getAnalytics(app);
    })
    .catch(() => {});
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
  googleProvider = new GoogleAuthProvider();

  onAuthStateChanged(auth, async (user) => {
    detachListeners();
    currentUser = user;
    setAuthUi(user);
    receiptsCache = [];
    questsCache = [];
    leaderboardCache = [];
    destroyCharts();

    if (!user) {
      renderLeaderboard([]);
      renderQuests([]);
      renderRecent([]);
      userUnlockedAchievementIds = new Set();
      userStatsCache = {};
      updateNavAndGreeting({ xp: 0, streak: 0, name: '' });
      destroyCharts();
      const sc = $('spendChart');
      const cc = $('catChart');
      if (sc && cc && typeof Chart !== 'undefined') {
        initOrRefreshCharts([]);
      }
      renderAchievementGrid();
      return;
    }

    await ensureUserProfile(user);
    await ensureDefaultAchievements();
    await ensureDefaultQuests(user.uid);

    subscribeLeaderboard();
    subscribeQuests(user.uid);
    subscribeReceipts(user.uid);
    subscribeUserDoc(user.uid);
    subscribeAchievementsMaster();
    subscribeUserAchievements(user.uid);

    getDoc(doc(db, 'users', user.uid)).then((s) => {
      if (s.exists()) updateNavAndGreeting(s.data());
    });
  });
}

boot();
