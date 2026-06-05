# SJTU Course Assistant Plus

English | [简体中文](README.zh-CN.md)

SJTU Course Assistant Plus enhances the SJTU course selection page with time-conflict filtering, jCourse links, course ratings, and optional AI-generated review summaries.

## What It Does

- Marks teaching classes that conflict with your already selected courses.
- Can hide conflicting classes and courses.
- Adds a jCourse community link for matched courses.
- Shows the jCourse average rating when a course can be matched.
- Generates review summaries with DeepSeek when you provide a DeepSeek API key.
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
- `Settings`: configure API keys, models, summary dimensions, and conflict hiding.
- `Clear errors`: clear displayed script error messages.

The script scans the selected-course schedule and compares it with the teaching classes currently shown on the page. Conflict labels are shown directly in the course list.

## jCourse Links And Ratings

The script can match SJTU course entries to jCourse data from:

```text
https://course.sjtu.plus
```

When a match is available, you may see:

- A `Course Community` link that opens the matching jCourse page.
- An average rating badge near the course title or status area.

jCourse data is requested only when you click the community link or a summary button.

## AI Review Summaries

The script supports DeepSeek for review summaries.

To enable summaries:

1. Click `Settings`.
2. Enter your DeepSeek API key.
3. Select or refresh the DeepSeek model list.
4. Save settings.
5. Click a review summary button in the course list.

The script does not call DeepSeek automatically. DeepSeek is called only when you click a summary button and a DeepSeek API key is configured.

For courses with multiple teachers, use the summary button next to a specific teaching class. A course-level summary may be unavailable because the teacher must be selected first.

## Settings

### DeepSeek API Key

Used to request AI summaries. Without this key, jCourse links and ratings can still work, but AI summaries cannot be generated.

### DeepSeek Model

The default model is `deepseek-v4-flash`. If an API key is configured, you can refresh the model list from DeepSeek.

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
- `api.deepseek.com` when you click a summary button and have configured a DeepSeek API key.

The script does not automatically send course data to DeepSeek during normal page scanning.

## Troubleshooting

If conflict labels look outdated, click `Rescan`.

If no community link or rating appears, the course may not be matched in jCourse, or the course name, teacher, or department information may be insufficient.

If summaries fail, check that:

- Your DeepSeek API key is correct.
- The selected model is available.
- The jCourse course can be matched.
- Your userscript manager allows cross-origin requests for the configured domains.

If the page layout changes after an SJTU system update, the script may need an update.
