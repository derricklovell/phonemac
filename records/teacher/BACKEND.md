# Teacher: backend proposals (not applied)

The Teacher record only uses what the elearn Supabase project already has. Building it turned up the gaps below. Each one is a proposed change; none of them has been made to the database. Apply any of them only when asked, after a backup.

| # | Gap | What the teacher sees today | Proposal |
|---|---|---|---|
| 1 | Video upload: nothing creates the video at the video host before the upload is signed | "Uploading isn't switched on yet"; a video can be attached by its library ID | Deploy the `bunny-create-video` edge function (§1), then set `config.video_create_url` |
| 2 | A lesson can't move to another section (`upsert_lesson` ignores `module_id` on update) | Lessons reorder only within their section | §2 |
| 3 | The class list has no names and no paused state (`lms_course_roster`) | "Member #18342"; Paused shows only after pausing here | §3 |
| 4 | The certificate setting can't be read (`issue_certificate` isn't returned anywhere) | "Not reported" until it's set in this session | §4 |
| 5 | Course player settings come back only with a lesson (`lms_lesson_player`) | A course without lessons shows only the order settings | §4 |
| 6 | Instructors can't remove a learner's comment (`lms_comments` deletes only your own) | Reply and pin only | §5 |
| 7 | Learning paths (tracks) can be read and issued, but not created or edited | An explanation | §6 |
| 8 | No coupons or discount codes | A note under Pricing | Needs a table and a check in the purchase flow; to design with checkout |
| 9 | No per-lesson completion counts (only `lesson_stats` views, likes, comments) | Views per lesson | §7 |
| 10 | Adding a student needs their member number | A "Member number" field | A lookup by email belongs in Xano (members are Xano users); then the dialog can take an email |
| 11 | Minting: Teacher mode (record 57 `s02`) mints each published lesson to the 9IN3 ledger, which is inactive | The new editor doesn't mint | Decide whether minting stays. If it does, reactivate 9IN3 or move the ledger, then add the mint step after a save |

## §1 `bunny-create-video` (edge function, draft)

The record calls it with the session's app token: `POST {lesson_id, title}` → `{guid, library_id}`. Then it signs the upload with `lms_bunny_sign_upload` and sends the file to Bunny's tus endpoint. The Bunny API key is a function secret. It never reaches the page.

```ts
// supabase/functions/bunny-create-video/index.ts — DRAFT, not deployed
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const { lesson_id, title } = await req.json().catch(() => ({}));
  if (!Number.isInteger(lesson_id)) return json({ error: "lesson_id required" }, 400);

  // As the caller: the store decides whether they author this lesson's course (§1b).
  const asCaller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const guard = await asCaller.rpc("lms_assert_lesson_author", { p_lesson_id: lesson_id });
  if (guard.error) return json({ error: guard.error.message }, 403);

  // As the service: the library id from lms.bunny_config, the key from the function's secrets.
  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { db: { schema: "lms" } });
  const { data: cfg } = await svc.from("bunny_config").select("library_id").eq("id", 1).single();
  const r = await fetch(`https://video.bunnycdn.com/library/${cfg!.library_id}/videos`, {
    method: "POST",
    headers: { AccessKey: Deno.env.get("BUNNY_API_KEY")!, "Content-Type": "application/json" },
    body: JSON.stringify({ title: String(title || `Lesson ${lesson_id}`).slice(0, 200) }),
  });
  if (!r.ok) return json({ error: `video host ${r.status}` }, 502);
  const v = await r.json();
  return json({ guid: v.guid, library_id: cfg!.library_id });
});
```

§1b is a small guard the function calls as the teacher:

```sql
create or replace function public.lms_assert_lesson_author(p_lesson_id bigint) returns jsonb
language plpgsql security definer set search_path to 'lms', 'public' as $$
begin
  perform lms.assert_author(lms.course_of_lesson(p_lesson_id));
  return jsonb_build_object('ok', true);
end $$;
```

## §2 Move a lesson to another section

In `lms_author_v2`, `upsert_lesson` (the update branch) gains a `module_id` that is honored only when the new section is in the same course:

```sql
module_id = case
  when (p_payload->>'module_id') is not null
   and (select course_id from lms.modules where id = (p_payload->>'module_id')::bigint)
     = (select m.course_id from lms.lessons l join lms.modules m on m.id = l.module_id where l.id = (p_payload->>'id')::bigint)
  then (p_payload->>'module_id')::bigint else module_id end,
```

The curriculum then allows dragging a lesson across sections.

## §3 Names and pauses in the class list

Add these to `lms.lms_course_roster_unguarded`'s row:

```sql
'display_name', (select pr.display_name from lms.profiles pr where pr.xano_user_id = e.xano_user_id),
'frozen_at', e.frozen_at, 'freeze_reason', e.freeze_reason,
```

Students then shows names, and shows Paused from the start.

## §4 Read a course's settings

A guarded read that returns everything Pricing & access and Certificates edit:

```sql
create or replace function public.lms_course_settings(p_course_id bigint) returns jsonb
language plpgsql stable security definer set search_path to 'lms', 'public' as $$
begin
  perform lms.assert_author(p_course_id);
  return (select jsonb_build_object('gating_enabled', gating_enabled, 'allow_skip_ahead', allow_skip_ahead,
    'show_discussion', show_discussion, 'show_transcript', show_transcript, 'autoplay_next', autoplay_next,
    'issue_certificate', issue_certificate, 'has_credential', access_credential is not null)
    from lms.courses where id = p_course_id);
end $$;
```

## §5 Instructor moderation of comments

Add a `moderate_delete` action to `public.lms_comments`, allowed when `lms.is_instructor_for_lesson(lesson, caller)` is true. It deletes the comment and its replies.

## §6 Authoring learning paths

These would let the Certificates tab build paths, guarded by `lms.assert_author` on every course in the path:
- `lms_track_upsert(p_payload)`: slug, title, subtitle, description, level, status, gating, certificate;
- `lms_track_courses_set(p_track_id, p_courses [{course_id, position, is_required}])`;
- `lms_tracks(p_merchant_id)`.

## §7 Per-lesson completion

`lms_course_lesson_completion(p_course_id)`, guarded, would return `{lesson_id, started, completed}` from `lms.lesson_progress`. Insights then shows drop-off between lessons as well as within them.
