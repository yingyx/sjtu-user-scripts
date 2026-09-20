# SJTU Course Assistant Plus

English | [简体中文](README.zh-CN.md)

SJTU Course Assistant Plus enhances the SJTU course selection page with time-conflict filtering, jCourse links, course ratings, and optional review summaries from DeepSeek or user-configured OpenAI-compatible LLMs.

## What It Does

- Marks teaching classes that conflict with your already selected courses.
- Can hide conflicting classes and courses.
- Allows multiple course panels to remain open; opening or closing one panel no longer collapses the others.
- Adds a jCourse community link for matched courses.
- Shows the jCourse average rating when a course can be matched.
- Manages multiple LLM providers and generates review summaries on demand.
- Lets you customize summary dimensions, such as attendance, interaction, and exams.

## Installation

1. Install a userscript manager, such as Tampermonkey.
2. Install this script from Greasy Fork.
3. Open the SJTU course selection page:

```text
https://i.sjtu.edu.cn/xsxk/zzxkyzb_cxZzxkYzbIndex.html
```

The script runs only on the matched SJTU course selection page.

## Basic Use

After the page loads, a toolbar named `SJTU Course Assistant Plus` appears near the course search area.

Use the toolbar to:

- `Hide conflicting courses`: hide teaching classes or course panels that conflict with courses you have already selected.
- `Rescan`: scan the current course list again after searching, expanding panels, or changing selected courses.
- `Settings`: manage LLM providers, API keys, models, summary dimensions, and conflict hiding.

The script scans the selected-course schedule and compares it with the teaching classes currently shown on the page. Conflict labels are shown directly in the course list.

## jCourse Links And Ratings

The script can match SJTU course entries to jCourse data from:

```text
https://course.sjtu.plus
```

When a match is available, you may see:

- A `Course Community ↗` link that opens the matching jCourse page in a new tab.
- An average rating badge near the course title or status area.

jCourse data is requested only when you click the community link or a summary button.

## AI Review Summaries

The script includes DeepSeek and supports custom OpenAI Chat Completions-compatible providers.

To enable summaries:

1. Click `Settings`.
2. Select built-in DeepSeek or add a custom LLM provider.
3. Enter the API key, Chat Completions endpoint, and model ID.
4. Save settings.
5. Click `Summarize reviews` in the course list.

The script does not call an LLM automatically. It sends reviews only when you click a summary button and the active provider is configured.

Single-class and multi-class courses use the same summary-card layout, with each result expanding below its teaching class. For courses with multiple teaching classes, every class gets its own summary action and multiple results can remain visible for comparison.

## Settings

### LLM Providers

DeepSeek is built in and cannot be removed. You can add, edit, remove, and switch custom providers. Custom providers must implement the OpenAI Chat Completions API. Endpoints must use HTTPS, except local services on `localhost` or `127.0.0.1`, which may use HTTP.

Each provider stores a display name, Chat Completions endpoint, API key, and model ID. The endpoint and model fields are displayed side by side. The built-in DeepSeek model defaults to `deepseek-v4-flash`; model IDs are entered directly and the script never fetches model lists.

### jCourse API Key

Optional. If provided, the script sends it as a Bearer token when requesting jCourse API data.

### Summary Dimensions

Each dimension tells the AI what to extract from reviews. The script supports:

- Yes/no dimensions: the output should be yes, no, or unknown, with a short explanation when useful.
- Open dimensions: the output should be a short phrase.

Examples:

- Attendance
- Interaction
- Exam
- Workload
- Grading style

### Hide Conflicts

When enabled, classes or course panels that conflict with your selected courses are hidden.

## Privacy And Network Requests

The script stores settings and caches in your userscript manager storage.

It may request:

- `course.sjtu.plus` when you click jCourse links or summary buttons.
- `api.deepseek.com` when you generate a summary with built-in DeepSeek.
- Any LLM endpoint you explicitly configure, when you generate a summary with it.

Summary requests send the active provider up to 12 jCourse reviews plus course, teacher, rating, semester, and review-time context. Provider settings, API keys, and caches stay in userscript-manager local storage. Normal page scanning sends no course data to an LLM.

## Troubleshooting

If conflict labels look outdated, click `Rescan`.

If no community link or rating appears, the course may not be matched in jCourse, or the course name, teacher, or department information may be insufficient.

If summaries fail, check that:

- The active provider's API key and endpoint are correct.
- The selected model is available and the service is OpenAI Chat Completions-compatible.
- The jCourse course can be matched.
- Your userscript manager allows cross-origin requests for the configured domains.

If the page layout changes after an SJTU system update, the script may need an update.

## Offline Testing Outside Enrollment Periods

The repository includes `tests/fixtures/sjtu-course-assistant-plus-page.html`. Its course-panel structure was extracted from the live SJTU page through CDP, but all course, teacher, and enrollment content has been replaced with test data and network requests are disabled.

Run `python -m http.server 8765` from the repository root, then open `http://127.0.0.1:8765/tests/fixtures/sjtu-course-assistant-plus-page.html` to load the userscript from the working tree and test conflict labels, single- and multi-class layouts, and multiple simultaneously open courses. Settings are stored only in the fixture page's own `localStorage`.
