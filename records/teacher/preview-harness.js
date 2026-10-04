// Preview harness for the Teacher record. NOT part of the record: the build puts it in front of the app
// only for the standalone preview (dist/records/teacher-*.html). It stands in for what the record talks
// to on the platform:
//   • the shell — answers app:ready with app:restore (a signed-in sample teacher who owns the sample
//     business, plus the app's saved state) and keeps app:state, as the appshell does per account;
//   • the elearn store — every Supabase RPC the record calls, answered from mock-courses.json the way the
//     real functions behave: the authoring guard, unique course URLs, cascading deletes, lessons kept in
//     their section on update, blocks and segments replaced as a whole (segment ids kept), questions
//     replaced per assessment, materials upserted by slug, the class list without names or pauses;
//   • the video service and the video host — the preview turns uploading on (the record's props leave
//     it off until the service exists) and accepts the file in chunks without sending it anywhere.
// Whatever you do in the preview is remembered in this browser; "Reset sample data" (bottom left) goes
// back to mock-courses.json. Nothing leaves the page.
(function () {
  "use strict";
  var SAMPLE = window.__TEACHER_MOCK__;
  var KEYS = { db: "teacher-preview:db:v2", state: "teacher-preview:app-state" };

  function read(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; } }
  function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage blocked: this visit only */ } }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function now() { return new Date().toISOString(); }
  function has(p, k) { return p[k] !== undefined && p[k] !== null; }
  function fail(status, code, message) { var e = new Error(message); e.status = status; e.code = code; throw e; }
  function nextId(list) { return list.reduce(function (n, x) { return Math.max(n, Number(x.id) || 0); }, 0) + 1; }

  var me = SAMPLE.me;
  var db = read(KEYS.db) || seed(clone(SAMPLE));
  function save() { write(KEYS.db, db); }

  // Class lists: each course's sample_learners become enrollments, the same ones every visit.
  function seed(d) {
    d.enrollments = [];
    var named = d.profiles.map(function (p) { return p.xano_user_id; }).filter(function (id) { return id !== me.profile_id; });
    d.courses.forEach(function (c) {
      var n = c.sample_learners || 0, rnd = prng(c.id), total = lessonsOf(d, c.id).length;
      for (var i = 0; i < n; i++) {
        var uid = c.id === 301 && i < named.length ? named[i] : 30000 + c.id * 1000 + i, roll = rnd();
        var status = roll < 0.24 ? "completed" : roll < 0.29 ? "dropped" : "active";
        var progress = status === "completed" ? 100 : Math.round(Math.pow(rnd(), 1.4) * 95);
        var enrolled = new Date(Date.UTC(2026, 5, 1) + Math.floor(rnd() * 120) * 864e5);
        d.enrollments.push({ id: c.id * 10000 + i, xano_user_id: uid, course_id: c.id, status: status, progress_pct: progress, enrolled_at: enrolled.toISOString(),
          completed_at: status === "completed" ? new Date(enrolled.getTime() + (10 + Math.floor(rnd() * 40)) * 864e5).toISOString() : null,
          lessons_done: Math.round(progress / 100 * total), certificate: status === "completed" && c.issue_certificate ? serial(rnd) : null, frozen: false });
      }
    });
    d.blocks.forEach(function (b, i) { b.id = 9000 + i; });
    return d;
  }
  function prng(s) { return function () { s |= 0; s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function serial(rnd) { var s = ""; for (var i = 0; i < 18; i++) s += "0123456789abcdef".charAt(Math.floor(rnd() * 16)); return s; }
  function course(id) { return db.courses.filter(function (c) { return c.id === Number(id); })[0]; }
  function mod(id) { return db.modules.filter(function (m) { return m.id === Number(id); })[0]; }
  function lesson(id) { return db.lessons.filter(function (l) { return l.id === Number(id); })[0]; }
  function lessonsOf(d, courseId) {
    var mods = d.modules.filter(function (m) { return m.course_id === courseId; }).map(function (m) { return m.id; });
    return d.lessons.filter(function (l) { return mods.indexOf(l.module_id) > -1; });
  }
  function courseOfLesson(id) { var l = lesson(id); return l ? course((mod(l.module_id) || {}).course_id) : null; }
  function assessment(id) { return db.assessments.filter(function (a) { return a.id === Number(id); })[0]; }
  function learners(courseId) { return db.enrollments.filter(function (e) { return e.course_id === courseId && e.status !== "dropped"; }).length; }

  // lms.assert_author / lms.author_guard: an owner, admin or instructor of the course's merchant, or its creator.
  function assertAuthor(c) {
    if (!c) fail(403, "42501", "course could not be resolved — refused");
    if (!/^(owner|admin|instructor)$/.test(me.roles[String(c.merchant_id)] || "") && c.created_by !== me.profile_id) fail(403, "42501", "not an author of this course");
  }
  function guard(action, p) {
    if (action === "upsert_course" && !has(p, "id")) {
      var mid = has(p, "merchant_id") ? Number(p.merchant_id) : SAMPLE.merchant.id;
      if (!/^(owner|admin|instructor)$/.test(me.roles[String(mid)] || "")) fail(403, "42501", "no authoring role: an owner, admin or instructor of the merchant can create courses");
      return;
    }
    var c = null;
    if (/_course$/.test(action)) c = course(p.id);
    else if (/_module$/.test(action)) c = has(p, "id") ? course((mod(p.id) || {}).course_id) : course(p.course_id);
    else if (/_lesson$/.test(action)) c = has(p, "id") ? courseOfLesson(p.id) : course((mod(p.module_id) || {}).course_id);
    else if (/assessment|questions/.test(action)) {
      var a = assessment(p.assessment_id || p.id);
      c = a ? course(a.course_id) : has(p, "lesson_id") ? courseOfLesson(p.lesson_id) : course(p.course_id);
    }
    assertAuthor(c);
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
          created_by: me.profile_id, updated_at: now(), price_cents: 0, currency: "USD", access: "open", channel_id: null,
          gating_enabled: true, allow_skip_ahead: false, show_discussion: true, show_transcript: true, autoplay_next: true, issue_certificate: true };
        db.courses.push(c);
      }
      return clone(c);
    },
    publish_course: function (p) { var c = course(p.id); c.status = "published"; c.updated_at = now(); return clone(c); },
    delete_course: function (p) {
      var c = course(p.id), mods = db.modules.filter(function (m) { return m.course_id === c.id; }).map(function (m) { return m.id; });
      db.lessons = db.lessons.filter(function (l) { return mods.indexOf(l.module_id) < 0; });
      db.modules = db.modules.filter(function (m) { return m.course_id !== c.id; });
      db.enrollments = db.enrollments.filter(function (e) { return e.course_id !== c.id; });
      db.courses = db.courses.filter(function (x) { return x !== c; });
      return { deleted: c.id };
    },
    upsert_module: function (p) {
      var m;
      if (has(p, "id")) { m = mod(p.id); ["title", "summary", "position"].forEach(function (k) { if (has(p, k)) m[k] = p[k]; }); }
      else {
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
      var l, keys = ["title", "kind", "duration_seconds", "media_url", "is_preview", "position", "min_complete_percent", "gates_next", "show_segments", "allow_comments"];
      if (has(p, "id")) { l = lesson(p.id); keys.forEach(function (k) { if (has(p, k)) l[k] = p[k]; }); } // never moves a lesson to another section
      else {
        var mid = Number(p.module_id);
        l = { id: nextId(db.lessons), module_id: mid, title: p.title, kind: p.kind || "video", duration_seconds: p.duration_seconds || 0, is_preview: !!p.is_preview, media_url: p.media_url || null,
          position: has(p, "position") ? p.position : db.lessons.filter(function (x) { return x.module_id === mid; }).reduce(function (n, x) { return Math.max(n, x.position); }, 0) + 1,
          min_complete_percent: 90, gates_next: true, show_segments: true, allow_comments: true };
        db.lessons.push(l);
      }
      return clone(l);
    },
    delete_lesson: function (p) { db.lessons = db.lessons.filter(function (l) { return l.id !== Number(p.id); }); return { deleted: Number(p.id) }; },
    get_assessment: function (p) {
      var a = assessment(p.id); if (!a) return null;
      return Object.assign(clone(a), { questions: db.questions.filter(function (q) { return q.assessment_id === a.id; }).sort(function (x, y) { return x.position - y.position; }).map(clone) });
    },
    upsert_assessment: function (p) {
      var a;
      if (has(p, "id")) { a = assessment(p.id); ["title", "kind", "pass_pct", "config", "lesson_id"].forEach(function (k) { if (has(p, k)) a[k] = p[k]; }); }
      else { a = { id: nextId(db.assessments), course_id: Number(p.course_id), lesson_id: Number(p.lesson_id), title: p.title || "Checkpoint", kind: p.kind || "quiz", pass_pct: has(p, "pass_pct") ? p.pass_pct : 100, config: p.config || {} }; db.assessments.push(a); }
      return clone(a);
    },
    replace_questions: function (p) {
      var aid = Number(p.assessment_id);
      db.questions = db.questions.filter(function (q) { return q.assessment_id !== aid; });
      (p.questions || []).forEach(function (q, i) {
        db.questions.push({ id: nextId(db.questions), assessment_id: aid, position: q.position || i + 1, kind: q.kind || "single", prompt: typeof q.prompt === "object" ? q.prompt : { text: q.prompt }, options: q.options, answer: q.answer, points: q.points || 1 });
      });
      return { assessment_id: aid, questions: (p.questions || []).length };
    },
    delete_assessment: function (p) {
      db.assessments = db.assessments.filter(function (a) { return a.id !== Number(p.id); });
      db.questions = db.questions.filter(function (q) { return q.assessment_id !== Number(p.id); });
      return { deleted: Number(p.id) };
    },
  };

  function catalogRow(c) {
    var ls = lessonsOf(db, c.id);
    return Object.assign(clone(c), { author_id: c.created_by, author_name: me.display_name, learner_count: learners(c.id),
      module_count: db.modules.filter(function (m) { return m.course_id === c.id; }).length, lesson_count: ls.length,
      duration_seconds: ls.reduce(function (n, l) { return n + l.duration_seconds; }, 0), enrolled: false, enrollment: null, progress_pct: 0 });
  }
  function merchantCheck(c, mid) { if (!c || (mid != null && c.merchant_id !== Number(mid))) fail(400, "P0002", "not found"); }

  var RPC = {
    lms_catalog: function (a) {
      return db.courses.filter(function (c) { return c.status === (a.p_status || "published") && (a.p_merchant_id == null || c.merchant_id === Number(a.p_merchant_id)); })
        .map(catalogRow).sort(function (x, y) { return x.title.localeCompare(y.title); });
    },
    lms_course_outline: function (a) {
      var c = db.courses.filter(function (x) { return x.slug === a.p_slug; })[0];
      merchantCheck(c, a.p_merchant_id);
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
    lms_lesson_player: function (a) {
      var l = lesson(a.p_lesson_id), c = courseOfLesson(a.p_lesson_id);
      merchantCheck(c, a.p_merchant_id);
      var m = mod(l.module_id), v = db.videos.filter(function (x) { return x.lesson_id === l.id; }).sort(function (x, y) { return x.position - y.position; })[0];
      return {
        lesson: Object.assign(clone(l), { course_id: c.id, module_title: m.title, module_position: m.position }),
        course: { id: c.id, title: c.title, slug: c.slug, level: c.level, gating_enabled: c.gating_enabled, allow_skip_ahead: c.allow_skip_ahead, show_discussion: c.show_discussion, show_transcript: c.show_transcript, autoplay_next: c.autoplay_next },
        lesson_locked: false, video: v ? clone(v) : null, enrollment: null,
        segments: db.segments.filter(function (s) { return s.lesson_id === l.id; }).sort(function (x, y) { return x.segment_index - y.segment_index; }).map(function (s) {
          var q = s.quiz || {};
          return { id: s.id, segment_index: s.segment_index, unit: s.unit, start_seconds: s.start_seconds, end_seconds: s.end_seconds, start_para: s.start_para, end_para: s.end_para, title: s.title,
            min_watch_percent: s.min_watch_percent, is_preview: s.is_preview, quiz_id: s.quiz ? s.id : null, assessment_id: q.assessment_id || null, pass_threshold: q.pass_threshold == null ? null : q.pass_threshold,
            max_attempts: q.max_attempts == null ? null : q.max_attempts, blocks_progress: s.quiz ? q.blocks_progress : null, retry_allowed: s.quiz ? q.retry_allowed : null, reveal_answer: s.quiz ? q.reveal_answer : null };
        }),
        blocks: db.blocks.filter(function (b) { return b.lesson_id === l.id; }).map(function (b, i) { return { id: b.id, block_index: i + 1, kind: b.kind, body: b.body, is_gated: b.is_gated, material_slug: b.material_slug }; }),
        materials: db.materials.filter(function (x) { return x.course_id === c.id && x.is_published; }).map(function (x) {
          return { slug: x.slug, kind: x.kind, title: x.title, subtitle: x.subtitle, body: x.body, data: x.data, anchor_seconds: x.anchor_seconds, anchor_para: x.anchor_para, related_slugs: x.related_slugs };
        }),
        resume: null,
      };
    },
    lms_assessment: function (a) {
      var x = a.p_assessment_id != null ? assessment(a.p_assessment_id) : db.assessments.filter(function (y) { return y.lesson_id === Number(a.p_lesson_id); }).sort(function (p, q) { return p.id - q.id; })[0];
      if (!x) return { error: "not_found" };
      return { id: x.id, title: x.title, kind: x.kind, pass_pct: x.pass_pct, lesson_id: x.lesson_id, course_id: x.course_id, questions: [], attempts: [] };
    },
    lms_author: function (a) {
      if (a.p_action !== "get_assessment" && !AUTHOR[a.p_action]) return { error: "unknown_action", action: a.p_action };
      guard(a.p_action, a.p_payload || {});
      var r = AUTHOR[a.p_action](a.p_payload || {});
      save();
      return r;
    },
    lms_blocks_replace: function (a) {
      assertAuthor(courseOfLesson(a.p_lesson_id));
      var id = Number(a.p_lesson_id), base = nextId(db.blocks);
      db.blocks = db.blocks.filter(function (b) { return b.lesson_id !== id; }).concat((a.p_blocks || []).map(function (b, i) {
        return { id: base + i, lesson_id: id, kind: b.kind, body: b.body, material_slug: b.material_slug || null, is_gated: b.is_gated !== false };
      }));
      save();
      return { lesson_id: id, blocks: (a.p_blocks || []).length };
    },
    lms_segments_replace: function (a) {
      assertAuthor(courseOfLesson(a.p_lesson_id));
      var id = Number(a.p_lesson_id), keep = [], base = nextId(db.segments);
      var next = (a.p_segments || []).map(function (s, i) {
        var old = s.id != null ? db.segments.filter(function (x) { return x.id === Number(s.id) && x.lesson_id === id; })[0] : null;
        var sid = old ? old.id : base + i;
        keep.push(sid);
        return { id: sid, lesson_id: id, segment_index: s.segment_index || i + 1, unit: s.unit || "time", start_seconds: s.start_seconds == null ? null : s.start_seconds, end_seconds: s.end_seconds == null ? null : s.end_seconds,
          start_para: s.start_para == null ? null : s.start_para, end_para: s.end_para == null ? null : s.end_para, title: s.title, min_watch_percent: s.min_watch_percent || 90, is_preview: !!s.is_preview,
          quiz: s.assessment_id ? { assessment_id: Number(s.assessment_id), pass_threshold: s.pass_threshold == null ? 100 : s.pass_threshold, max_attempts: s.max_attempts == null ? null : s.max_attempts,
            blocks_progress: s.blocks_progress !== false, retry_allowed: s.retry_allowed !== false, reveal_answer: !!s.reveal_answer } : null };
      });
      db.segments = db.segments.filter(function (x) { return x.lesson_id !== id; }).concat(next);
      save();
      return { lesson_id: id, segments: next.length, ids: keep };
    },
    lms_material_upsert: function (a) {
      var p = a.p_payload || {}, cid = Number(p.course_id);
      assertAuthor(course(cid));
      if (a.p_action === "material_delete") { db.materials = db.materials.filter(function (m) { return !(m.course_id === cid && m.slug === p.slug); }); save(); return { deleted: true }; }
      var row = { course_id: cid, slug: p.slug, kind: p.kind, title: p.title, subtitle: p.subtitle, body: p.body, data: p.data || {}, anchor_seconds: p.anchor_seconds, anchor_para: p.anchor_para, related_slugs: p.related_slugs || [], is_published: p.is_published !== false };
      var at = db.materials.findIndex(function (m) { return m.course_id === cid && m.slug === p.slug; });
      if (at > -1) db.materials[at] = row; else db.materials.push(row);
      save();
      return { id: at > -1 ? at + 1 : db.materials.length };
    },
    lms_video_upsert: function (a) {
      var p = a.p_payload || {};
      assertAuthor(courseOfLesson(p.lesson_id));
      var v = db.videos.filter(function (x) { return x.bunny_library_id === Number(p.bunny_library_id) && x.bunny_video_guid === p.bunny_video_guid; })[0];
      var fields = { lesson_id: Number(p.lesson_id), duration_seconds: p.duration_seconds || 0, thumbnail_url: p.thumbnail_url || null, captions_url: p.captions_url || null, position: p.position || 0, meta: p.meta || {} };
      if (v) Object.assign(v, fields);
      else { v = Object.assign({ id: nextId(db.videos), bunny_library_id: Number(p.bunny_library_id), bunny_video_guid: p.bunny_video_guid }, fields); db.videos.push(v); }
      save();
      return { id: v.id };
    },
    lms_bunny_sign_upload: function (a) {
      var known = db.videos.filter(function (v) { return v.bunny_video_guid === a.p_video_guid; })[0];
      if (known) assertAuthor(courseOfLesson(known.lesson_id));
      return { library_id: 900001, cdn_hostname: null, expires: Math.floor(Date.now() / 1000) + (a.p_expires_seconds || 3600), signature: "preview-signature" };
    },
    lms_course_price: function (a) { var c = course(a.p_course_id); return { id: c.id, slug: c.slug, title: c.title, status: c.status, access: c.access, price_cents: c.price_cents, currency: c.currency, merchant_id: c.merchant_id, channel_id: c.channel_id, cover_url: c.cover_url }; },
    lms_course_rules: function (a) { var c = course(a.p_course_id); return { course_id: c.id, access: c.access, gating_enabled: c.gating_enabled, allow_skip_ahead: c.allow_skip_ahead, price_cents: c.price_cents, currency: c.currency, merchant_id: c.merchant_id, lessons: {} }; },
    lms_course_price_set: function (a) { var c = course(a.p_course_id); assertAuthor(c); c.price_cents = Math.max(0, a.p_price_cents || 0); c.currency = String(a.p_currency || "USD").toUpperCase(); save(); return { ok: true }; },
    lms_course_access_set: function (a) { var c = course(a.p_course_id); assertAuthor(c); c.access = a.p_access; c.access_credential = a.p_access === "credential" ? a.p_credential : null; save(); return { ok: true }; },
    lms_channels: function (a) { return db.channels.filter(function (ch) { return a.p_merchant_id == null || ch.merchant_id === Number(a.p_merchant_id); }).map(clone); },
    lms_course_channel_set: function (a) {
      var c = course(a.p_course_id), ch = db.channels.filter(function (x) { return x.id === Number(a.p_channel_id); })[0];
      assertAuthor(c);
      if (!ch || ch.merchant_id !== c.merchant_id) fail(403, "42501", "channel belongs to another merchant");
      c.channel_id = ch.id; save(); return { ok: true };
    },
    lms_flags_set: function (a) {
      var target = a.p_scope === "course" ? course(a.p_id) : lesson(a.p_id);
      assertAuthor(a.p_scope === "course" ? target : courseOfLesson(a.p_id));
      Object.keys(a.p_flags || {}).forEach(function (k) { if (a.p_flags[k] != null) target[k] = a.p_flags[k]; });
      save(); return { ok: true, scope: a.p_scope, id: a.p_id };
    },
    lms_course_roster: function (a) {
      var c = course(a.p_course_id); assertAuthor(c);
      return db.enrollments.filter(function (e) { return e.course_id === c.id; }).sort(function (x, y) { return y.enrolled_at.localeCompare(x.enrolled_at); }).map(function (e) {
        return { enrollment_id: e.id, xano_user_id: e.xano_user_id, status: e.status, progress_pct: e.progress_pct, enrolled_at: e.enrolled_at, completed_at: e.completed_at, lessons_done: e.lessons_done, certificate: e.certificate };
      });
    },
    lms_grant_enrollment: function (a) {
      var c = course(a.p_course_id); assertAuthor(c);
      var e = db.enrollments.filter(function (x) { return x.course_id === c.id && x.xano_user_id === Number(a.p_user_id); })[0];
      if (e) { e.frozen = false; if (e.status === "dropped") e.status = "active"; }
      else db.enrollments.push({ id: nextId(db.enrollments), xano_user_id: Number(a.p_user_id), course_id: c.id, status: "active", progress_pct: 0, enrolled_at: now(), completed_at: null, lessons_done: 0, certificate: null, frozen: false });
      save(); return { ok: true, course_id: c.id, user_id: Number(a.p_user_id), source: a.p_source };
    },
    lms_enrollment_freeze: function (a) {
      var c = course(a.p_course_id); assertAuthor(c);
      var e = db.enrollments.filter(function (x) { return x.course_id === c.id && x.xano_user_id === Number(a.p_user_id); })[0];
      if (!e) fail(400, "42704", "no enrolment to freeze");
      e.frozen = !!a.p_frozen; save(); return { ok: true, frozen: e.frozen };
    },
    lms_lesson_stats: function (a) {
      var s = db.lesson_stats[String(a.p_lesson_id)] || { views: 0, likes: 0, dislikes: 0 };
      return { lesson_id: Number(a.p_lesson_id), views: s.views, likes: s.likes, dislikes: s.dislikes, comments: db.comments.filter(function (c) { return c.lesson_id === Number(a.p_lesson_id); }).length, my_reaction: null, saved: false };
    },
    lms_segment_analytics: function (a) {
      assertAuthor(courseOfLesson(a.p_lesson_id));
      return db.segments.filter(function (s) { return s.lesson_id === Number(a.p_lesson_id); }).sort(function (x, y) { return x.segment_index - y.segment_index; }).map(function (s) {
        var st = db.segment_stats[String(s.id)] || { reached: 0, completed: 0, avg_percent: 0, quiz_attempts: 0, quiz_passed: 0 };
        return { segment_id: s.id, segment_index: s.segment_index, title: s.title, unit: s.unit, reached: st.reached, completed: st.completed, avg_percent: st.avg_percent, quiz_attempts: st.quiz_attempts, quiz_passed: st.quiz_passed };
      });
    },
    lms_comments: function (a) {
      var p = a.p_payload || {};
      var name = function (uid) { var pr = db.profiles.filter(function (x) { return x.xano_user_id === uid; })[0]; return pr ? pr.display_name : "Learner " + uid; };
      var shape = function (c) { return { id: c.id, body: c.body, created_at: c.created_at, edited_at: null, pinned_at: c.pinned_at, xano_user_id: c.xano_user_id, is_instructor: c.is_instructor, author_name: name(c.xano_user_id), likes: c.likes, liked_by_me: false }; };
      if (a.p_action === "list") {
        return db.comments.filter(function (c) { return c.lesson_id === Number(p.lesson_id) && !c.parent_id; }).map(function (c) {
          return Object.assign(shape(c), { replies: db.comments.filter(function (r) { return r.parent_id === c.id; }).sort(function (x, y) { return x.created_at.localeCompare(y.created_at); }).map(shape) });
        });
      }
      if (a.p_action === "add") {
        var c = courseOfLesson(p.lesson_id), instructor = !!c && /^(owner|admin|instructor)$/.test(me.roles[String(c.merchant_id)] || "");
        var row = { id: nextId(db.comments), lesson_id: Number(p.lesson_id), xano_user_id: me.profile_id, body: String(p.body || "").slice(0, 2000), created_at: now(), parent_id: p.parent_id || null, is_instructor: instructor, pinned_at: null, likes: 0 };
        db.comments.push(row); save(); return clone(row);
      }
      if (a.p_action === "pin" || a.p_action === "unpin") {
        var cm = db.comments.filter(function (x) { return x.id === Number(p.id); })[0];
        if (!cm || (a.p_action === "pin" && cm.parent_id)) return { error: "not_found" };
        cm.pinned_at = a.p_action === "pin" ? now() : null; save(); return clone(cm);
      }
      return { error: "unknown_action" };
    },
  };

  function reply(body, status, headers) { return new Response(body == null ? null : JSON.stringify(body), { status: status || 200, headers: Object.assign({ "Content-Type": "application/json" }, headers || {}) }); }
  var uploads = {}; // the stand-in video host: upload address -> bytes received
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var rpc = /\/rest\/v1\/rpc\/(\w+)(?:[?#]|$)/.exec(url);
    var exchange = /\/functions\/v1\/xano-session(?:[?#]|$)/.test(url);
    var create = /preview\/video-create$/.test(url), tus = /preview\/tusupload/.test(url);
    if (!rpc && !exchange && !create && !tus) return realFetch(input, init);
    var method = (init && init.method) || "GET", args = {};
    if (!tus) { try { args = JSON.parse((init && init.body) || "{}"); } catch (e) {} }
    return new Promise(function (r) { setTimeout(r, tus ? 60 : 120); }).then(function () {
      if (exchange) return reply({ app_token: "preview-app-token", expires_in: 3600 });
      if (create) { var g = "c0ffee00-0000-4000-8000-" + String(Date.now()).slice(-12).padStart(12, "0"); return reply({ guid: g, library_id: 900001 }); }
      if (tus) {
        var h = (init && init.headers) || {};
        if (method === "POST") { var loc = "preview/tusupload/" + h.VideoId; uploads[loc] = { size: Number(h["Upload-Length"]), got: 0 }; return reply(null, 201, { Location: loc }); }
        var key = url.replace(/^.*?(preview\/tusupload\/.*)$/, "$1"), up = uploads[key];
        if (!up) return reply({ error: "unknown upload" }, 404);
        up.got = Number(h["Upload-Offset"]) + ((init.body && init.body.size) || 0);
        return reply(null, 204, { "Upload-Offset": String(up.got) });
      }
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
  document.addEventListener("DOMContentLoaded", function () { document.body.appendChild(bar); });
})();
