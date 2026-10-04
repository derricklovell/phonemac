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

The course builder for E Learn: the Teachable-style home for a teacher. It's step 1 of making record 57's Teacher mode a full authoring tool. Its layout:
- **Your courses** (sidebar): drafts, published and archived, each with its lesson and learner counts, plus search and **New course**.
- **Curriculum**:
  - sections and lessons: add, rename in place and delete (deleting asks in the page, not with `window.confirm`, which the appshell's sandbox blocks);
  - reorder by dragging the ⋮⋮ grip, or focus the grip and use ↑ ↓;
  - a **Free preview** toggle per lesson;
  - **Edit content**, which hands the lesson to the lesson editor.
- **Details**: title, subtitle, description, level, course URL, cover image link and tags, with Save and Discard. The danger zone archives or deletes the course (deleting needs the title typed).
- **Publish / Unpublish / Restore as draft** in the header. An empty course can't be published.

**Data, all from functions that already exist** in the elearn Supabase project (`config.supabase_url`, with its publishable key, which is public by design):
- `lms_catalog` (per status) and `lms_course_outline` read the courses, scoped to `_viewer.merchant_id`. Only the courses this teacher may author are listed: owner, admin or instructor of the merchant, or the course's creator. This is the same rule Teacher mode uses.
- `lms_author` writes: `upsert_course`, `publish_course`, `delete_course`, `upsert_module`, `delete_module`, `upsert_lesson`, `delete_lesson`. `lms.author_guard` checks every write on the server. Writes run one at a time, and the header shows *Saving… / All changes saved / Last change not saved*. A reorder writes the new `position` of each item that moved.

Requests carry the app token from `app:restore`. It's refreshed through `config.session_exchange` (xano-session) with the session token, as in Teacher mode. The open course and tab are kept with `app:state`.

**Gaps found in the backend** (not worked around):
- `upsert_lesson` never changes a lesson's `module_id` on update, so a lesson can't be moved to another section. Reordering happens within a section. A one-line change to `lms_author_v2` would allow it.
- `lms_course_outline` doesn't return a lesson's `allow_comments`, `gates_next` or `min_complete_percent`, so those settings belong in the lesson editor (step 2).

**Edit content** posts `view:swap` to `config.lesson_editor` (record 57 `s02`, today's lesson editor) with `context: {course_id, course_slug, lesson_id}`. Today's `s02` doesn't read that context yet: it opens on its own pickers. Step 2 replaces it with a lesson editor that opens the lesson it's handed.

**Local preview (Teacher on its own):** `npm run build` writes `dist/records/teacher-local.html` (also `dist/local/teacher.html`) and `dist/records/teacher-preview.html` for the claude.ai artifact. `preview-harness.js` stands in for the shell and for the store's RPCs, answering from `mock-courses.json` the way the real functions behave:
- the authoring guard;
- unique course URLs;
- cascading deletes;
- sections fixed on lesson update.

What you build in the preview is kept in that browser. **Reset sample data** (bottom left) starts over. Nothing is sent anywhere. The harness is never part of the record.

**Not in the database:** nothing here has been written to record 57 or to Supabase. To ship it, replace record 57's Teacher mode slot with `teacher.html` and merge `props.json` into the record's props. Do this only when asked, after a backup, and read the record back afterwards.
