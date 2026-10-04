// Preview harness for the Mail record. NOT part of the record: the build puts it in front of the
// app only for the standalone preview (dist/records/mail-*.html). It stands in for the two things the
// record talks to on the platform:
//   • the shell — answers app:ready with app:restore (a signed-in sample user + the app's saved state)
//     and keeps app:state, as the appshell does per account;
//   • the API — messages/inbox, messages/send and messages/state answered from mock-inbox.json, behaving
//     like the real endpoints (archived threads leave the inbox, replies are added as email, read /
//     pin / mute / hide change the marks).
// What you do in the preview (replies, marks, status, notes) is remembered in this browser; the mock
// data itself is read fresh from the page each time, so edits to mock-inbox.json always show.
(function () {
  "use strict";
  var DATA = window.__MAIL_MOCK__;
  var KEYS = { state: "mail-preview:app-state", marks: "mail-preview:marks", sent: "mail-preview:sent" };
  var SESSION = { username: "sample-owner", user_id: "preview-owner", display_name: DATA.me.display_name, auth_token: "preview-token" };

  function read(key, empty) {
    try { var v = JSON.parse(localStorage.getItem(key) || "null"); return v == null ? empty : v; } catch (e) { return empty; }
  }
  function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage blocked: this visit only */ } }

  var loadedAt = Date.now();
  var marks = read(KEYS.marks, {}); // thread id -> { read, pinned, muted, hidden }
  var sent = read(KEYS.sent, {}); // thread id -> [{ id, text, ts }]

  function inbox() {
    var threads = DATA.threads.map(function (t) {
      var mk = marks[t.id] || {};
      var msgs = t.messages.map(function (m) {
        var o = Object.assign({}, m, { ts: loadedAt - m.ago * 60000 });
        delete o.ago;
        return o;
      }).concat((sent[t.id] || []).map(function (s) { return { id: s.id, out: true, text: s.text, ts: s.ts, delivered: true, read: true, via: "email" }; }));
      var th = Object.assign({}, t, {
        time: msgs.length ? msgs[msgs.length - 1].ts : loadedAt,
        unread: mk.read ? 0 : t.unread,
        pinned: mk.pinned !== undefined ? mk.pinned : t.pinned,
        muted: mk.muted !== undefined ? mk.muted : t.muted,
        messages: msgs,
      });
      delete th.ago;
      return th;
    }).filter(function (t) { return !(marks[t.id] && marks[t.id].hidden); });
    return { me: DATA.me, business: DATA.business, sources: DATA.sources, note: DATA.note, threads: threads };
  }

  function reply(body, status) {
    return new Response(JSON.stringify(body), { status: status || 200, headers: { "Content-Type": "application/json" } });
  }
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var route = /\/messages\/(inbox|send|state)(?:[?#]|$)/.exec(url);
    if (!route) return realFetch(input, init);
    var args = {};
    try { args = (JSON.parse((init && init.body) || "{}").args) || {}; } catch (e) {}
    return new Promise(function (r) { setTimeout(r, 150); }).then(function () {
      if (route[1] === "inbox") return reply(inbox());
      if (route[1] === "send") {
        var item = { id: "sent-" + Date.now(), text: String(args.text || ""), ts: Date.now() };
        (sent[args.thread_id] = sent[args.thread_id] || []).push(item);
        write(KEYS.sent, sent);
        return reply({ message: { id: item.id, ts: item.ts, via: "email" } });
      }
      var mk = marks[args.thread_id] = marks[args.thread_id] || {};
      if (args.op === "read") mk.read = true;
      if (args.op === "pin") mk.pinned = !!args.on;
      if (args.op === "mute") mk.muted = !!args.on;
      if (args.op === "hide") mk.hidden = !!args.on;
      write(KEYS.marks, marks);
      return reply({ ok: true, op: args.op });
    });
  };

  // The shell: one window here, so the app's posts to its parent arrive on this window.
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || typeof d.gin !== "string") return;
    if (d.gin === "app:ready") {
      var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      window.postMessage({ gin: "app:restore", view_id: null, state: read(KEYS.state, null), ts: 0, authed: true, user: SESSION, appearance: "system", scheme: dark ? "dark" : "light" }, "*");
    }
    if (d.gin === "app:state") write(KEYS.state, d.state);
  });
})();
