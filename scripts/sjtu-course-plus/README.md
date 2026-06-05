# SJTU Course Assistant Plus

GreasyFork entry file:

```text
scripts/sjtu-course-plus/sjtu-course-plus.user.js
```

## Current Behavior

- Enhances SJTU course selection pages matched by the userscript metadata.
- Detects selected-course time slots and marks candidate teaching classes as conflict, non-conflict, or unknown.
- Adds a course community link using `https://course.sjtu.plus/course?q=<courseNameOrCode>`.
- Fetches jCourse data only after the user clicks a summary button.
- Uses DeepSeek only, default model `deepseek-v4-flash`.
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
node --check scripts\sjtu-course-plus\sjtu-course-plus.user.js
Select-String -Path scripts\sjtu-course-plus\sjtu-course-plus.user.js -Pattern '\.some\(|\.filter\(|\.map\(|Array\.from|\.find\(' -Context 0,0
```

The second command should produce no matches.
