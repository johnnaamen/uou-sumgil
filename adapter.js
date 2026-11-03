/* 울산대 숨길 — Supabase 연결부
   페이지 본문은 window.claude.use("room" | "db") 형태로 실시간 기능을 부릅니다.
   이 파일이 그 자리를 Supabase Realtime(접속자 위치)과 reports 테이블(연기·혼잡 신고)로 채웁니다.
   config.js가 비어 있으면 null을 돌려줘서, 페이지는 혼자 보기 모드로 동작합니다. */
(function () {
  "use strict";
  var cfg = window.SUMGIL_CONFIG || {};
  var ready = cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase && window.supabase.createClient;
  if (!ready) {
    window.claude = { use: function () { return Promise.resolve(null); } };
    return;
  }
  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 15 } }
  });
  var uid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));

  // ---------- room: 같은 페이지에 접속한 사람들 (Realtime Presence) ----------
  var roomPromise = null;
  // Supabase 무료 한도: Presence 초당 20건(프로젝트 전체). 그래서
  //  - 걷기처럼 자주 바뀌는 상태는 Broadcast로 초당 최대 4번만 보내고
  //  - Presence(접속 목록)는 건물 입장·퇴장·꾸미기 바뀔 때, 그리고 5초마다 한 번만 갱신해요.
  var SLOW = { x: 1, y: 1, px: 1, pz: 1, ry: 1 };
  function makeRoom() {
    return new Promise(function (resolve) {
      var ch = sb.channel(cfg.channel || "uou-campus", { config: { presence: { key: uid }, broadcast: { self: false } } });
      var mine = {}, peers = Object.freeze([]), listeners = new Set(), done = false;
      var live = {};            // key -> {p, t}  Broadcast로 받은 최신 상태
      var bTimer = null, bLast = 0, pTimer = null, pLast = 0, pSig = "";
      function rebuild() {
        var st = ch.presenceState(), list = [], now = Date.now(), seen = {};
        Object.keys(st).forEach(function (k) {
          var metas = st[k] || [], m = metas[metas.length - 1] || {}, b = live[k];
          var useB = b && (!(typeof m.t === "number") || b.t >= m.t);
          var p = useB ? b.p : (m.p || {}), t = useB ? b.t : (typeof m.t === "number" ? m.t : now);
          seen[k] = 1;
          list.push(Object.freeze({ peer: k, by: null, isMe: k === uid, sameTab: k === uid, kind: "viewer", guest: false,
            presence: Object.freeze(Object.assign({}, p)), updatedAt: t }));
        });
        Object.keys(live).forEach(function (k) { if (!seen[k]) { if (now - live[k].t < 15000 && k !== uid) list.push(Object.freeze({ peer: k, by: null, isMe: false, sameTab: false, kind: "viewer", guest: false, presence: Object.freeze(Object.assign({}, live[k].p)), updatedAt: live[k].t })); else delete live[k]; } });
        if (!seen[uid]) list.push(Object.freeze({ peer: uid, by: null, isMe: true, sameTab: true, kind: "viewer", guest: false, presence: Object.freeze(Object.assign({}, mine)), updatedAt: now }));
        peers = Object.freeze(list);
        listeners.forEach(function (fn) { try { fn({ peers: peers, joined: [], left: [], updated: [] }); } catch (e) {} });
      }
      var rbQueued = false;
      function queueRebuild() { if (rbQueued) return; rbQueued = true; setTimeout(function () { rbQueued = false; rebuild(); }, 50); }
      function sendB() { bTimer = null; bLast = Date.now(); ch.send({ type: "broadcast", event: "s", payload: { k: uid, p: Object.assign({}, mine), t: Date.now() } }).catch(function () {}); }
      function sendP() { pTimer = null; pLast = Date.now(); ch.track({ p: Object.assign({}, mine), t: Date.now() }).catch(function () {}); }
      function sig() { var o = {}; Object.keys(mine).forEach(function (k) { if (!SLOW[k] && k !== "act" && k !== "emo" && k !== "emoAt" && k !== "jAt" && k !== "say" && k !== "sayAt") o[k] = mine[k]; }); return JSON.stringify(o); }
      var api = {
        presence: function (patch) {
          Object.keys(patch || {}).forEach(function (k) { if (patch[k] === null) delete mine[k]; else mine[k] = patch[k]; });
          var bw = 250 - (Date.now() - bLast);
          if (bw <= 0) sendB(); else if (!bTimer) bTimer = setTimeout(sendB, bw);
          var s2 = sig();
          if (s2 !== pSig) { pSig = s2; var pw = 1000 - (Date.now() - pLast); clearTimeout(pTimer); pTimer = setTimeout(sendP, Math.max(0, pw)); }
          return Promise.resolve();
        },
        onPeers: function (fn) { listeners.add(fn); setTimeout(function () { fn({ peers: peers, joined: peers, left: [], updated: [] }); }, 0); return function () { listeners.delete(fn); }; },
        peers: function () { return peers; },
        emit: function () { return Promise.resolve(); },
        on: function () { return function () {}; }
      };
      ch.on("presence", { event: "sync" }, queueRebuild)
        .on("presence", { event: "leave" }, function (e) { (e.leftPresences ? [e.key] : []).forEach(function (k) { delete live[k]; }); queueRebuild(); })
        .on("broadcast", { event: "s" }, function (msg) { var d = msg && msg.payload; if (!d || typeof d.k !== "string" || d.k === uid || !d.p) return; live[d.k] = { p: d.p, t: typeof d.t === "number" ? d.t : Date.now() }; queueRebuild(); })
        .subscribe(function (status) {
          if (status === "SUBSCRIBED") { sendP(); if (!done) { done = true; resolve(api); } }
          if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT") && !done) { done = true; resolve(null); }
        });
      setInterval(function () { if (Date.now() - pLast > 5000) sendP(); }, 5000);
      setTimeout(function () { if (!done) { done = true; resolve(null); } }, 10000);
    });
  }

  // ---------- db: 연기·혼잡 신고 (reports 테이블 + Realtime INSERT) ----------
  function toDoc(r) { var d = { kind: r.kind, x: r.x, y: r.y, ts: Number(r.ts) }; return { id: r.id, exists: true, data: function () { return d; } }; }
  var db = {
    collection: function () {
      var q = {
        orderBy: function () { return q; },
        limit: function () { return q; },
        onSnapshot: function (next, onErr) {
          var rows = [], stopped = false, feed = null;
          function emit(changes) {
            if (stopped) return;
            next({ docs: rows.map(toDoc), size: rows.length, empty: !rows.length, docChanges: function () { return changes; } });
          }
          (async function () {
            var since = Date.now() - 30 * 60 * 1000;
            var res = await sb.from("reports").select("id,kind,x,y,ts").gt("ts", since).order("ts", { ascending: false }).limit(300);
            if (res.error) { if (onErr) onErr({ code: "unavailable", message: res.error.message }); return; }
            rows = res.data || []; emit([]);
            feed = sb.channel("uou-reports-feed")
              .on("postgres_changes", { event: "INSERT", schema: "public", table: "reports" }, function (pl) {
                var r = pl.new; if (!r || rows.some(function (x) { return x.id === r.id; })) return;
                rows = [r].concat(rows).slice(0, 300);
                emit([{ type: "added", doc: toDoc(r) }]);
              })
              .subscribe();
          })();
          return function () { stopped = true; if (feed) sb.removeChannel(feed); };
        },
        doc: function () {
          var id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : null;
          return {
            id: id,
            set: async function (d) {
              var row = { kind: d.kind, x: Math.round(d.x), y: Math.round(d.y) };
              if (id) row.id = id;
              var res = await sb.from("reports").insert(row);
              if (res.error) throw res.error;
            }
          };
        }
      };
      return q;
    }
  };

  window.claude = {
    use: function (name) {
      if (name === "room") { if (!roomPromise) roomPromise = makeRoom(); return roomPromise; }
      if (name === "db") return Promise.resolve(db);
      return Promise.resolve(null);
    }
  };
})();
