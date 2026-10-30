# Exercise library

SET-07: "Exercise library with videos". Done when: exercises with dose defaults and video playable on
phones. Sources:

- PRD M7: "home programme from the exercise library".
- PRD M13: "My plan (… exercises with videos …)".
- PRD section 10: "Exercise videos, or a plan to film them", from the client.
- TAD: `kb_exercise` (name, video file, default dose) and the private `exercise-media` bucket
  ("Patients via token; staff").
- Frontend Specification "Exercise row: Name, dose, video, done tick".

The workbooks name exercises only as free text per condition, so the library is the clinic's own.
Every choice below is a recommended default chosen under the user's standing approval, 30 October
2026 (DECISION SET-07), for the client to confirm.

## The library

- **Who keeps it:** the Super Admin (`exercises.manage`), on **Exercise library** (`/app/exercises`).
  Everyone signed in reads it (the plan editor); a Velyx support login changes nothing.
- **An exercise:** a name, a default dose as the plan shows it ("3 × 10, daily", up to 120 characters
  each) and, once the clinic films it, a video.
- **The video:** MP4 or WebM, recognised by its first bytes (never by the file's name; an MP4 by its brand, so HEIC and AVIF images and QuickTime files are refused), at most
  `exercises.video_max_mb` (4 MB: the hosted request limit). A short clip filmed for phones. It is kept
  in the private `exercise-media` bucket; only our server reaches it (rule 9).
- **Never changed:** **Change or remove**, then **Save as a new version**, adds a new exercise. Without
  a new video it keeps the old one's. The old one is retired, naming its replacement. **Remove from
  library** retires it. Plans already written keep the exercise they used. The database refuses any
  other change (`internal.exercise_guard`), and every add and retire is audited.

## The home programme

On the consultation's **Plan**, **From the exercise library** lists the active exercises (with
", video" where filmed). **Add from library** adds a row with the exercise's name and default dose,
both editable, and remembers the exercise (`exerciseId` on the row), marked "From the library" (or
"From the library, with its video"). Renaming such a row drops the link: it is no longer that exercise, nor its video. Typed exercises work as before.

## My plan

- **Watching:** an exercise from the library with a video shows **Watch the video**; it plays on the
  page (`/p/<token>/exercises/<exercise>`, nothing loaded until played).
- **Who may watch:** the patient reaches a video only for an exercise in their own plan, through their
  working My plan link (`internal.my_plan_exercise_video`); anything else is "Not found".
- **Phones:** the video is served in byte ranges (`206`), as phones' players ask, with its length; a Range not served (another unit, several ranges) is ignored and the clip sent as without one; staff watch the same
  on the library screen (`/app/exercises/<exercise>/video`, signed in).

## Tests

- `packages/schemas/src/exercises.test.ts`: the name and dose; a video by its bytes and size; the
  ranges.
- `apps/web/modules/consultations/services.test.ts`: the library offered with the plan.
- `packages/db/src/integration/exercises.integration.test.ts`:
  - only the Super Admin adds, not a physio or the desk;
  - a change is refused and never removed;
  - staff read it;
  - retired once, replaced only by an active exercise;
  - a patient gets the video of their own plan's exercise only;
  - the library itself is staff only.
- `apps/web/e2e/exercise-library.spec.ts` (360 px and desktop):
  - a file that is not a video is refused;
  - the exercise is added with its video and served in ranges;
  - the patient watches it on My plan;
  - another exercise is not found.
- `apps/web/e2e/consultation.spec.ts`: **Add from library** on the plan, saved with the exercise.

**Negative check:** drop the plan check from `internal.my_plan_exercise_video`, and the database test
fails ("not in their plan").
