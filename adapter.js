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
  function makeRoom() {
    return new Promise(function (resolve) {
      var ch = sb.channel(cfg.channel || "uou-campus", { config: { presence: { key: uid } } });
      var mine = {}, peers = Object.freeze([]), listeners = new Set(), timer = null, lastSent = 0, done = false;
      function rebuild() {
        var st = ch.presenceState(), list = [];
        Object.keys(st).forEach(function (k) {
          var metas = st[k] || [], m = metas[metas.length - 1] || {};
          list.push(Object.freeze({
            peer: k, by: null, isMe: k === uid, sameTab: k === uid, kind: "viewer", guest: false,
            presence: Object.freeze(Object.assign({}, m.p || {})), updatedAt: typeof m.t === "number" ? m.t : Date.now()
          }));
        });
        peers = Object.freeze(list);
        listeners.forEach(function (fn) { try { fn({ peers: peers, joined: [], left: [], updated: [] }); } catch (e) {} });
      }
      function send() {
        timer = null; lastSent = Date.now();
        ch.track({ p: Object.assign({}, mine), t: Date.now() }).catch(function () {});
      }
      var api = {
        presence: function (patch) {
          Object.keys(patch || {}).forEach(function (k) { if (patch[k] === null) delete mine[k]; else mine[k] = patch[k]; });
          var wait = 140 - (Date.now() - lastSent);
          if (wait <= 0) send(); else if (!timer) timer = setTimeout(send, wait);
          return Promise.resolve();
        },
        onPeers: function (fn) { listeners.add(fn); setTimeout(function () { fn({ peers: peers, joined: peers, left: [], updated: [] }); }, 0); return function () { listeners.delete(fn); }; },
        peers: function () { return peers; },
        emit: function () { return Promise.resolve(); },
        on: function () { return function () {}; }
      };
      ch.on("presence", { event: "sync" }, rebuild)
        .subscribe(function (status) {
          if (status === "SUBSCRIBED" && !done) { done = true; resolve(api); }
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
