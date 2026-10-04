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

**Not yet in the database:** it has no record id. Locally it's tab `900` (`props/fixtures/tabs.json`), served by the test mock as `viewer_iframe` would serve it. To publish it:
1. Create the record with `mail.html` as `s01` and `devs01`, `props.json` as `props`, and `dev.json` as `dev` (with the new id as `view_id`).
2. Add it to an account's apps (`me/apps`).

Do this only when asked, after a backup, and read the record back afterwards.
