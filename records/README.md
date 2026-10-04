# Records

Apps that live in the 1ovr1 database as their own records. The desktop hosts them like appshell tabs. Each folder is one record, kept here as plain files:

| file | record column |
|---|---|
| `<app>.html` | `s01` / `devs01`: one standalone page with the placeholder `var componentProps = {};` |
| `props.json` | `props`: the app's strings, settings, theme and icons. `viewer_iframe` injects them along with `_viewer` (`merchant_id`, `requested_view`) |
| `dev.json` | `dev`: the app's face (name, icon path, colour, `s01_only`, …). This is the tab entry `devshell` puts in Record 50's `tabs` |

Snapshots of existing records, which are only ever read here, live in `props/fixtures/records/`. They include `54.s01.html` (Booking) and `74.s01.html` (Messages).

## Mail (`records/mail/`)

A shared support inbox for the email a business receives through its website. Its layout:
- mailboxes;
- a conversation list;
- the thread, with a reply box that switches between replying and a private note;
- a details panel.

It adapts to a window, to full width and to a phone.

**Data, all from endpoints that already exist:**
- `GET messages/inbox` gives the threads. Mail keeps only `config.kinds`, the website-form (`contact`) conversations.
- `POST messages/send` with `{kind: "email", thread_id, email, subject, text}` sends a reply from the business. Only an owner or admin can send.
- `POST messages/state` with `read`, `pin`, `mute` or `hide` (archive) changes those flags.

Requests send the session's Bearer token and `x-merchant-id` (`_viewer.merchant_id`), as Booking does.

**Not shared yet:** status (Open, Snoozed, Resolved, Closed), priority, assignee, tags and private notes. There are no server fields for these. The app keeps them in its own state, which the shell saves per account through `app:state` / `app:restore`. Shared team triage needs an endpoint and table for that metadata.

**Origin:** the interaction patterns (views, statuses, reply versus private note, details sidebar) follow open-source helpdesks such as Libredesk (AGPL-3.0). No Libredesk code, assets or branding are used: the code, design and wording are original.

**Local preview (Mail on its own):** `npm run build` writes `dist/records/mail-local.html`, a complete page to open in a browser, and `dist/records/mail-preview.html`, the same page for the claude.ai artifact. Each is the record exactly as the viewer would serve it (`props.json` plus `_viewer`, injected), with `preview-harness.js` in front of it. The harness stands in for the shell (a signed-in sample user and saved state) and for the API (`messages/inbox`, `send` and `state`, answered from `mock-inbox.json` the way the real endpoints behave), so the page opens populated and every action works. To change what you see:
- the look and the app: `mail.html` and `props.json`;
- the sample conversations: `mock-inbox.json` (times are "minutes ago").

Then rebuild. The harness is never part of the record.

**Not yet in the database:** it has no record id. Locally it's tab `900` (`props/fixtures/tabs.json`), served by the test mock as `viewer_iframe` would serve it. To publish it:
1. Create the record with `mail.html` as `s01` and `devs01`, `props.json` as `props`, and `dev.json` as `dev` (with the new id as `view_id`).
2. Add it to an account's apps (`me/apps`).

Do this only when asked, after a backup, and read the record back afterwards.

## Teacher (`records/teacher/`)

The E Learn teacher app, Teachable-style. It is to replace record 57's Teacher mode. Everything runs on functions the elearn Supabase project already has (`config.supabase_url`, with its publishable key, which is public by design). The store checks every write (`lms.author_guard` / `lms.assert_author`: owner, admin or instructor of the merchant). Writes run one at a time, and the header shows *Saving… / All changes saved / Last change not saved*. Confirmations happen in the page, because the appshell's sandbox blocks `window.confirm`.

**Courses (sidebar) and Curriculum.** Drafts, published and archived courses, with search and New course.
- Sections and lessons: add, rename in place, reorder (drag the ⋮⋮ grip, or focus it and press ↑ ↓), Free preview, delete.
- Publish / Unpublish / Restore as draft are in the header.
- Functions used: `lms_catalog`, `lms_course_outline`, and `lms_author` (`upsert_course` / `_module` / `_lesson`, `delete_*`, `publish_course`).

**Details.** Title, subtitle, description, level, course URL, cover link and tags. Archive, and delete with the course title typed to confirm.

**Lesson editor** (Edit content). Loaded with `lms_lesson_player` (plus `get_assessment` for its quizzes). Save writes only the parts that changed.
- **Content:**
  - blocks the Classroom reader shows: paragraph, heading, pull quote, figure, worked example;
  - paragraphs are rich text limited to the reader's two inline forms, bold and term links (stored as the reader's own `<b>` markup);
  - Return starts a new paragraph; blocks can be gated, duplicated, reordered and deleted;
  - a live learner preview sits beside the blocks;
  - course materials (terms, figures as SVG, worked examples with steps, notes) are saved straight away with `lms_material_upsert`;
  - saved with `lms_blocks_replace`.
- **Video & media:**
  - upload: the video service creates the video, `lms_bunny_sign_upload` signs it, the file goes to Bunny's tus endpoint in chunks, and `lms_video_upsert` records it;
  - or attach a library video by its ID;
  - thumbnail, captions (.vtt) and length;
  - a media link for audio.
- **Segments & checkpoints:** time or paragraph ranges, done-at %, free preview, and a checkpoint quiz per segment (pass mark, attempts, retry, reveal answers, must pass to continue). Saved with `upsert_assessment` + `replace_questions`, then `lms_segments_replace`, which keeps segment ids and so keeps learner progress. Removed checkpoints are deleted.
- **Questions** (quiz lessons): title, quiz or exam, pass mark, shuffle, reveal answers. Question types are one answer, true/false, several answers, short answer (exact match) and number, each with points. The Classroom currently shows learners one-answer questions only, so the other types are flagged.
- **Settings:** title, type, length, complete at %, free preview, lock the next lesson, comments, segment list.
- Problems (a question without a correct answer, a bad range…) are listed above the editor and block saving.

**Pricing & access.** Price and currency (`lms_course_price` / `_set`); who can enroll: open, invite only or access code (`lms_course_access_set`); channel (`lms_channels`, `lms_course_channel_set`); learning-experience switches (`lms_flags_set`).

**Students.** Class list (`lms_course_roster`) with progress, lessons done and certificate. Add a student by member number (`lms_grant_enrollment`). Pause or restore access (`lms_enrollment_freeze`).

**Insights.** A funnel (enrolled → started → halfway → completed) and per-lesson views, likes and comments (`lms_lesson_stats`). Choose a lesson to see inside it: reached, finished, average done and checkpoint passes per segment (`lms_segment_analytics`).

**Comments.** Every lesson's threads, filtered by lesson and by "waiting for you". Reply as the instructor and pin (`lms_comments`).

**Certificates.** Turn course certificates on or off (`lms_flags_set`) and see the ones issued (from the class list).

**What the backend can't do yet** is listed in [`teacher/BACKEND.md`](teacher/BACKEND.md), with proposed changes (none applied):
- a video service, so upload can be switched on (drafted there);
- moving lessons between sections;
- names and pauses in the class list;
- reading the certificate setting;
- removing learners' comments;
- authoring learning paths;
- coupons;
- per-lesson completion;
- adding a student by email;
- minting.

**Local preview:** `npm run build` writes `dist/records/teacher-local.html` (also `dist/local/teacher.html`) and `dist/records/teacher-preview.html` for the claude.ai artifact. `preview-harness.js` stands in for the shell, for every store function above (answering from `mock-courses.json` the way the real ones behave), and for the video service and host. Upload is switched on in the preview only (`config.video_create_url` is `""` in `props.json` until the service exists). What you do in the preview is kept in that browser. **Reset sample data** (bottom left) starts over. Nothing is sent anywhere. The harness is never part of the record.

**Not in the database:** nothing here has been written to record 57 or to Supabase. To ship it, replace record 57's Teacher mode slot (`s02`) with `teacher.html` and merge `props.json` into the record's props. Do this only when asked, after a backup, and read the record back afterwards.
