// Preview harness for the Teacher record. NOT part of the record: the build puts it in front of the app
// only for the standalone preview (dist/records/teacher-*.html). It stands in for the two things the
// record talks to on the platform:
//   • the shell — answers app:ready with app:restore (a signed-in sample teacher who owns the sample
//     business, plus the app's saved state) and keeps app:state, as the appshell does per account;
//   • the elearn store — the Supabase RPCs the record calls (lms_catalog, lms_course_outline, lms_author)
//     and the xano-session token exchange, answered from mock-courses.json the way the real functions
//     behave: the authoring guard, unique course URLs, cascading deletes, and upsert_lesson leaving a
//     lesson's section alone on update.
// Whatever you build in the preview is remembered in this browser; "Reset sample data" (bottom left)
// goes back to mock-courses.json. Nothing leaves the page.
(function () {
  "use strict";
  var SAMPLE = window.__TEACHER_MOCK__;
  var KEYS = { db: "teacher-preview:db", state: "teacher-preview:app-state" };

  function read(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; } }
  function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage blocked: this visit only */ } }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  var db = read(KEYS.db) || clone(SAMPLE);
  function save() { write(KEYS.db, db); }
  var me = SAMPLE.me;

  function nextId(list) { return list.reduce(function (n, x) { return Math.max(n, x.id); }, 0) + 1; }
  function course(id) { return db.courses.filter(function (c) { return c.id === Number(id); })[0]; }
  function mod(id) { return db.modules.filter(function (m) { return m.id === Number(id); })[0]; }
  function lesson(id) { return db.lessons.filter(function (l) { return l.id === Number(id); })[0]; }
  function lessonsOf(courseId) {
    var mods = db.modules.filter(function (m) { return m.course_id === courseId; }).map(function (m) { return m.id; });
    return db.lessons.filter(function (l) { return mods.indexOf(l.module_id) > -1; });
  }
  function fail(status, code, message) { var e = new Error(message); e.status = status; e.code = code; throw e; }
  function has(p, k) { return p[k] !== undefined && p[k] !== null; }
  function now() { return new Date().toISOString(); }

  // lms.author_guard: an owner, admin or instructor of the course's merchant (or of the one named, for a new course).
  function guard(action, p) {
    var c = null;
    if (action === "upsert_course" && !has(p, "id")) {
      var mid = has(p, "merchant_id") ? Number(p.merchant_id) : SAMPLE.merchant.id;
      if (!/^(owner|admin|instructor)$/.test(me.roles[String(mid)] || "")) fail(403, "42501", "no authoring role: an owner, admin or instructor of the merchant can create courses");
      return;
    }
    if (/_course$/.test(action)) c = course(p.id);
    else if (/_module$/.test(action)) c = has(p, "id") ? course((mod(p.id) || {}).course_id) : course(p.course_id);
    else if (/_lesson$/.test(action)) c = has(p, "id") ? course((mod((lesson(p.id) || {}).module_id) || {}).course_id) : course((mod(p.module_id) || {}).course_id);
    if (!c) fail(403, "42501", "course could not be resolved for " + action + " — refused");
    if (!/^(owner|admin|instructor)$/.test(me.roles[String(c.merchant_id)] || "") && c.created_by !== me.profile_id) fail(403, "42501", "not an author of this course");
  }
  function slugFree(slug, id) { return !db.courses.some(function (c) { return c.slug === slug && c.id !== id; }); }

  var AUTHOR = {
    upsert_course: function (p) {
      var c;
      if (has(p, "id")) {
        c = course(p.id);
        if (has(p, "slug") && p.slug !== "" && !slugFree(p.slug, c.id)) fail(409, "23505", 'duplicate key value violates unique constraint "courses_slug_key"');
        ["title", "subtitle", "description", "level", "cover_url", "status"].forEach(function (k) { if (has(p, k)) c[k] = p[k]; });
        if (has(p, "slug") && p.slug !== "") c.slug = p.slug;
        if (has(p, "tags")) c.tags = p.tags.slice();
        c.updated_at = now();
      } else {
        var slug = p.slug || String(p.title).toLowerCase().replace(/[^a-z0-9]+/g, "-");
        if (!slugFree(slug, null)) fail(409, "23505", 'duplicate key value violates unique constraint "courses_slug_key"');
        c = { id: nextId(db.courses), slug: slug, title: p.title, subtitle: p.subtitle || null, description: p.description || null, level: p.level || null,
          cover_url: p.cover_url || null, tags: p.tags || [], meta: {}, status: p.status || "draft", merchant_id: has(p, "merchant_id") ? Number(p.merchant_id) : SAMPLE.merchant.id,
          created_by: me.profile_id, learner_count: 0, updated_at: now() };
        db.courses.push(c);
      }
      return clone(c);
    },
    publish_course: function (p) { var c = course(p.id); c.status = "published"; c.updated_at = now(); return clone(c); },
    delete_course: function (p) {
      var c = course(p.id), mods = db.modules.filter(function (m) { return m.course_id === c.id; }).map(function (m) { return m.id; });
      db.lessons = db.lessons.filter(function (l) { return mods.indexOf(l.module_id) < 0; });
      db.modules = db.modules.filter(function (m) { return m.course_id !== c.id; });
      db.courses = db.courses.filter(function (x) { return x !== c; });
      return { deleted: c.id };
    },
    upsert_module: function (p) {
      var m;
      if (has(p, "id")) {
        m = mod(p.id);
        ["title", "summary", "position"].forEach(function (k) { if (has(p, k)) m[k] = p[k]; });
      } else {
        var cid = Number(p.course_id);
        m = { id: nextId(db.modules), course_id: cid, title: p.title, summary: p.summary || null,
          position: has(p, "position") ? p.position : db.modules.filter(function (x) { return x.course_id === cid; }).reduce(function (n, x) { return Math.max(n, x.position); }, 0) + 1 };
        db.modules.push(m);
      }
      return clone(m);
    },
    delete_module: function (p) {
      db.lessons = db.lessons.filter(function (l) { return l.module_id !== Number(p.id); });
      db.modules = db.modules.filter(function (m) { return m.id !== Number(p.id); });
      return { deleted: Number(p.id) };
    },
    upsert_lesson: function (p) {
      var l;
      if (has(p, "id")) {
        l = lesson(p.id); // like the real function, an update never moves a lesson to another section
        ["title", "kind", "duration_seconds", "media_url", "is_preview", "position", "min_complete_percent", "gates_next", "allow_comments"].forEach(function (k) { if (has(p, k)) l[k] = p[k]; });
      } else {
        var mid = Number(p.module_id);
        l = { id: nextId(db.lessons), module_id: mid, title: p.title, kind: p.kind || "video", duration_seconds: p.duration_seconds || 0, is_preview: !!p.is_preview,
          position: has(p, "position") ? p.position : db.lessons.filter(function (x) { return x.module_id === mid; }).reduce(function (n, x) { return Math.max(n, x.position); }, 0) + 1 };
        db.lessons.push(l);
      }
      return clone(l);
    },
    delete_lesson: function (p) { db.lessons = db.lessons.filter(function (l) { return l.id !== Number(p.id); }); return { deleted: Number(p.id) }; },
  };

  var RPC = {
    lms_catalog: function (a) {
      return db.courses.filter(function (c) { return c.status === (a.p_status || "published") && (a.p_merchant_id == null || c.merchant_id === Number(a.p_merchant_id)); })
        .map(function (c) {
          var ls = lessonsOf(c.id);
          return Object.assign(clone(c), {
            author_id: c.created_by, author_name: me.display_name,
            module_count: db.modules.filter(function (m) { return m.course_id === c.id; }).length, lesson_count: ls.length,
            duration_seconds: ls.reduce(function (n, l) { return n + l.duration_seconds; }, 0),
            enrolled: false, enrollment: null, progress_pct: 0,
          });
        }).sort(function (x, y) { return x.title.localeCompare(y.title); });
    },
    lms_course_outline: function (a) {
      var c = db.courses.filter(function (x) { return x.slug === a.p_slug; })[0];
      if (!c || (a.p_merchant_id != null && c.merchant_id !== Number(a.p_merchant_id))) fail(400, "P0002", "course not found");
      var out = clone(c);
      out.enrollment = null;
      out.modules = db.modules.filter(function (m) { return m.course_id === c.id; }).sort(function (x, y) { return x.position - y.position; }).map(function (m) {
        return { id: m.id, position: m.position, title: m.title, summary: m.summary,
          lessons: db.lessons.filter(function (l) { return l.module_id === m.id; }).sort(function (x, y) { return x.position - y.position; }).map(function (l) {
            return { id: l.id, position: l.position, title: l.title, kind: l.kind, duration_seconds: l.duration_seconds, is_preview: l.is_preview, media_url: null, progress: null };
          }) };
      });
      return out;
    },
    lms_author: function (a) {
      var fn = AUTHOR[a.p_action];
      if (!fn) return { error: "unknown_action", action: a.p_action };
      guard(a.p_action, a.p_payload || {});
      var r = fn(a.p_payload || {});
      save();
      return r;
    },
  };

  function reply(body, status) { return new Response(JSON.stringify(body), { status: status || 200, headers: { "Content-Type": "application/json" } }); }
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var rpc = /\/rest\/v1\/rpc\/(\w+)(?:[?#]|$)/.exec(url);
    var exchange = /\/functions\/v1\/xano-session(?:[?#]|$)/.test(url);
    if (!rpc && !exchange) return realFetch(input, init);
    var args = {};
    try { args = JSON.parse((init && init.body) || "{}"); } catch (e) {}
    return new Promise(function (r) { setTimeout(r, 120); }).then(function () {
      if (exchange) return reply({ app_token: "preview-app-token", expires_in: 3600 });
      var fn = RPC[rpc[1]];
      if (!fn) return reply({ code: "PGRST202", message: "Could not find the function public." + rpc[1] }, 404);
      try { return reply(fn(args)); } catch (e) { return reply({ code: e.code || "XX000", message: e.message }, e.status || 500); }
    });
  };

  // The shell: one window here, so the app's posts to its parent arrive on this window.
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || typeof d.gin !== "string") return;
    if (d.gin === "app:ready") {
      var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      window.postMessage({ gin: "app:restore", view_id: null, state: read(KEYS.state), ts: 0, authed: true, appearance: "system", scheme: dark ? "dark" : "light",
        user: { profile_id: me.profile_id, display_name: me.display_name, roles: me.roles, auth_token: "preview-session", app_token: "preview-app-token", app_token_at: Date.now(), app_token_expires_in: 3600 } }, "*");
    }
    if (d.gin === "app:state") write(KEYS.state, d.state);
    if (d.gin === "view:swap") note("Preview: in the app this opens lesson " + (d.context && d.context.lesson_id) + " in the lesson editor (record " + d.view_id + " " + d.slot_code + ").");
  });

  // Preview-only controls, outside the record's UI.
  var bar = document.createElement("div");
  bar.style.cssText = "position:fixed;left:10px;bottom:10px;z-index:30;display:flex;gap:6px;align-items:center;font:11px -apple-system,system-ui,sans-serif";
  bar.innerHTML = '<span style="padding:4px 8px;border-radius:10px;background:#1d1d1f;color:#fff;opacity:.75">Preview · sample data</span>' +
    '<button type="button" style="all:unset;cursor:pointer;padding:4px 8px;border-radius:10px;background:#e3e3e8;color:#1d1d1f">Reset sample data</button>';
  bar.querySelector("button").addEventListener("click", function () {
    try { localStorage.removeItem(KEYS.db); localStorage.removeItem(KEYS.state); } catch (e) {}
    location.reload();
  });
  var noteEl = document.createElement("div");
  noteEl.style.cssText = "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:30;max-width:calc(100% - 32px);padding:8px 12px;border-radius:9px;background:#1d1d1f;color:#fff;font:12px -apple-system,system-ui,sans-serif;display:none";
  function note(msg) { noteEl.textContent = msg; noteEl.style.display = "block"; clearTimeout(note._t); note._t = setTimeout(function () { noteEl.style.display = "none"; }, 4000); }
  document.addEventListener("DOMContentLoaded", function () { document.body.appendChild(bar); document.body.appendChild(noteEl); });
})();
