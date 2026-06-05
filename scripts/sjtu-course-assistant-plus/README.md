# SJTU Course Assistant Plus

GreasyFork entry file:

```text
scripts/sjtu-course-assistant-plus/sjtu-course-assistant-plus.user.js
```

## Current Behavior

- Enhances SJTU course selection pages matched by the userscript metadata.
- Detects selected-course time slots and marks candidate teaching classes as selected, conflict, non-conflict, or unknown.
- Adds a course community link that resolves a matched jCourse course and opens `https://course.sjtu.plus/course/<course_id>`.
- Fetches jCourse data only after the user clicks a summary button.
- Supports optional jCourse API Key authentication through `Authorization: Bearer <api_key>`.
- Uses DeepSeek only, default model `deepseek-v4-flash`.
- Fetches available DeepSeek models from `https://api.deepseek.com/models` in the settings panel when an API key is configured.
- Displays jCourse average rating near the native course status text.
- Displays LLM summary in a second line in the course heading.
- Supports dimension settings in a table with type, label, and note.

## Compatibility Notes

The SJTU/ZF page has polluted `Array` prototype behavior. Keep avoiding these in
the userscript:

- `.some(`
- `.filter(`
- `.map(`
- `Array.from`
- `.find(`

Use explicit loops and local helper functions instead.

## Validation

Run from the project root:

```powershell
node --check scripts\sjtu-course-assistant-plus\sjtu-course-assistant-plus.user.js
Select-String -Path scripts\sjtu-course-assistant-plus\sjtu-course-assistant-plus.user.js -Pattern '\.some\(|\.filter\(|\.map\(|Array\.from|\.find\(' -Context 0,0
```

The second command should produce no matches.
