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
  // Supabase 무료 한도에 맞춘 설계 (https://supabase.com/docs/guides/realtime/limits)
  //  - Presence(접속 목록): 한 사람당 30초에 5번까지 → 건물 입장/퇴장·꾸미기가 바뀔 때만, 최소 7초 간격으로 보내요.
  //  - 움직임: Broadcast로 "어디로 가는지(목적지)"만 보내고, 받는 쪽 화면이 알아서 걸어가게 해요.
  //  - 3D 건물 안 움직임은 건물마다 따로 채널을 열어서, 그 건물 사람들한테만 가요.
  var SIGK = ["in", "nick", "col", "acc", "st"];
  function noop() {}
  function makeRoom() {
    return new Promise(function (resolve) {
      var base = cfg.channel || "uou-campus";
      var lobby = sb.channel(base, { config: { presence: { key: uid }, broadcast: { self: false } } });
      var bch = null, bname = null, lastLobbyIn;
      var mine = {}, peers = Object.freeze([]), listeners = new Set(), done = false, live = {};
      var bTimer = null, bLast = 0, pTimer = null, pLast = 0, pSig = "";
      function chName(n) { var h = 0; for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0; return base + "-b" + h.toString(36); }
      function mkPeer(k, p, t, me) { return Object.freeze({ peer: k, by: null, isMe: me, sameTab: me, kind: "viewer", guest: false, presence: Object.freeze(Object.assign({}, p)), updatedAt: t }); }
      function rebuild() {
        var st = lobby.presenceState(), list = [], now = Date.now(), seen = {};
        Object.keys(st).forEach(function (k) {
          var metas = st[k] || [], m = metas[metas.length - 1] || {}, b = live[k];
          var mt = typeof m.t === "number" ? m.t : 0, useB = b && b.t >= mt;
          seen[k] = 1; list.push(mkPeer(k, useB ? b.p : (m.p || {}), useB ? b.t : (mt || now), k === uid));
        });
        Object.keys(live).forEach(function (k) { if (!seen[k] && k !== uid) { if (now - live[k].t < 20000) list.push(mkPeer(k, live[k].p, live[k].t, false)); else delete live[k]; } });
        if (!seen[uid]) list.push(mkPeer(uid, mine, now, true));
        peers = Object.freeze(list);
        listeners.forEach(function (fn) { try { fn({ peers: peers, joined: [], left: [], updated: [] }); } catch (e) {} });
      }
      var rbQueued = false;
      function queueRebuild() { if (rbQueued) return; rbQueued = true; setTimeout(function () { rbQueued = false; rebuild(); }, 50); }
      function payload() { return { k: uid, p: Object.assign({}, mine), t: Date.now() }; }
      function bsend(c, pl) { c.send({ type: "broadcast", event: "s", payload: pl }).catch(noop); }
      function sendB() {
        bTimer = null; bLast = Date.now();
        var pl = payload(), cur = mine["in"] || null, inside = bch && bname === cur && cur;
        bsend(inside ? bch : lobby, pl);
        if (cur !== lastLobbyIn) { if (inside) bsend(lobby, pl); lastLobbyIn = cur; }
      }
      function sendP() { pTimer = null; pLast = Date.now(); lobby.track(payload()).catch(noop); }
      function onMsg(msg) { var d = msg && msg.payload; if (!d || typeof d.k !== "string" || d.k === uid || !d.p) return; live[d.k] = { p: d.p, t: typeof d.t === "number" ? d.t : Date.now() }; queueRebuild(); }
      function onHi(msg) { var d = msg && msg.payload; if (!d || d.k === uid) return; setTimeout(sendB, 200 + Math.random() * 1200); }
      function syncBuilding() {
        var want = mine["in"] || null; if (want === bname) return;
        if (bch) { sb.removeChannel(bch); bch = null; }
        bname = want; if (!want) return;
        var c = sb.channel(chName(want), { config: { broadcast: { self: false } } }); bch = c;
        c.on("broadcast", { event: "s" }, onMsg).on("broadcast", { event: "hi" }, onHi)
          .subscribe(function (s) { if (s === "SUBSCRIBED" && bch === c) { c.send({ type: "broadcast", event: "hi", payload: { k: uid } }).catch(noop); sendB(); } });
      }
      function sig() { var o = {}; SIGK.forEach(function (k) { o[k] = mine[k] === undefined ? null : mine[k]; }); return JSON.stringify(o); }
      var api = {
        presence: function (patch) {
          Object.keys(patch || {}).forEach(function (k) { if (patch[k] === null) delete mine[k]; else mine[k] = patch[k]; });
          syncBuilding();
          var bw = 150 - (Date.now() - bLast);
          if (bw <= 0) sendB(); else if (!bTimer) bTimer = setTimeout(sendB, bw);
          var s2 = sig();
          if (!pLast) { pSig = s2; sendP(); }
          else if (s2 !== pSig) { pSig = s2; if (!pTimer) pTimer = setTimeout(sendP, Math.max(0, 7000 - (Date.now() - pLast))); }
          return Promise.resolve();
        },
        onPeers: function (fn) { listeners.add(fn); setTimeout(function () { fn({ peers: peers, joined: peers, left: [], updated: [] }); }, 0); return function () { listeners.delete(fn); }; },
        peers: function () { return peers; },
        emit: function () { return Promise.resolve(); },
        on: function () { return function () {}; }
      };
      lobby.on("presence", { event: "sync" }, queueRebuild)
        .on("presence", { event: "join" }, function (e) { if (e && e.key && e.key !== uid && !mine["in"]) setTimeout(sendB, 300 + Math.random() * 1500); })
        .on("presence", { event: "leave" }, function (e) { if (e && e.key) delete live[e.key]; queueRebuild(); })
        .on("broadcast", { event: "s" }, onMsg)
        .subscribe(function (status) {
          if (status === "SUBSCRIBED") { if (!done) { done = true; resolve(api); } }
          if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT") && !done) { done = true; resolve(null); }
        });
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
