# Shuiyuan Deep Search

English | [简体中文](README.zh-CN.md)

Shuiyuan Deep Search decomposes a question into complementary site searches, reads relevant Shuiyuan topics, and produces a structured report whose claims link back to their sources. You can continue the conversation after a report, and the script can search for additional evidence when the existing sources are insufficient.

## Features

- Plans 3–6 complementary Discourse queries, including independent searches for core terms and likely Chinese names, aliases, categories, and uses.
- Expands sparse searches in at most two bounded rounds while avoiding duplicate queries and topics.
- Screens candidates by title and bounded snippets before reading, while probing up to two rejected candidates when every snippet is rejected.
- Runs up to four searches and three topic reads concurrently, deduplicates results, and ranks relevant topics.
- Reads paginated topic content with configurable limits, checks evidence gaps, and performs bounded supplemental searches.
- Produces a concise summary, findings, evidence limitations, suggested follow-ups, and source links.
- Decides whether each follow-up needs new evidence and may read up to three unseen topics before answering.
- Supports DeepSeek by default and arbitrary OpenAI-compatible Chat Completions endpoints.
- Shows cancellable stage-by-stage progress and isolates the panel in a Shadow DOM.
- Skips recognizable Discourse private-message topics.
- Saves completed reports and successful follow-ups locally, with offline reopening, continued questions, and confirmed per-record deletion.

The script runs only on:

```text
https://shuiyuan.sjtu.edu.cn/*
```

## Installation and configuration

1. Install a userscript manager such as Tampermonkey or Violentmonkey.
2. Install the script from GreasyFork.
3. Sign in to Shuiyuan and click the magnifier-and-sparkles icon to the left of native search.
4. On first use, enter the API endpoint, model, and API key, then save the settings.
5. To change the configuration later, use the sliders icon in the panel header.

The default endpoint is `https://api.deepseek.com/chat/completions` and the default model is `deepseek-v4-flash`. You may enter another OpenAI-compatible `/chat/completions` endpoint and model, including OpenAI's `https://api.openai.com/v1/chat/completions`.

Remote custom endpoints must use HTTPS. `localhost`, `127.0.0.1`, and `[::1]` may use HTTP and may omit the API key. The metadata declares DeepSeek, OpenAI, common local hosts, and `@connect *`; the userscript manager may ask you to approve a new host or all hosts on first connection.

## Usage

Enter a question and select **Start research**, or press `Ctrl/⌘ + Enter`. The script plans searches, screens and reads topics, checks evidence gaps, and generates the report. Open a citation to inspect the original topic.

If a name is uncertain, describe the remembered spelling together with its brand, purpose, or category. Search expansion may explore likely aliases, but factual conclusions still require topic evidence and should retain relevant dates and conditions.

After a report, enter a follow-up or select a suggested question. The script first checks the current report, conversation, and sources. If needed, it runs up to three new queries and reads up to three unseen topics. A conversation retains at most `max(12, initial topic limit × 3)` topics.

Completed reports and successful follow-ups are saved automatically. Use the history icon to reopen, continue, or delete records. Opening a saved record is offline and does not require LLM settings. In-progress or failed answers are not saved, and history cannot be switched or deleted while research is running.

History is limited to 20 records and 8 MiB of serialized UTF-8 data. The script does not evict old records automatically. If saving fails, the visible result remains available with a retry action; delete unneeded history before retrying. Deletion requires confirmation and has no recycle bin. Concurrent writes from multiple tabs are not guaranteed to merge atomically.

To bound latency and cost, follow-ups send a shortened report and the latest four conversation rounds, screening uses excerpts of at most 240 characters, and planning excerpts are bounded. The page keeps the full current report and conversation in memory, but older details may not be included in every model request.

## Privacy and network requests

The userscript manager stores the endpoint, API key, model, topic limits, and history locally. History contains questions, search plans and hit counts, reports, source links, read excerpts that may include authors and dates, and successful follow-ups. It does not make an extra copy of the API key or provider configuration. Stored history belongs to the browser profile rather than a Shuiyuan account and persists until deleted or userscript storage is cleared.

The script makes two kinds of requests:

- Same-origin requests to Shuiyuan search and topic JSON endpoints, using the browser's current login session.
- Requests to the configured LLM endpoint containing the question, search plan and hit counts, candidate titles and snippets, selected author names, dates and post excerpts, the report, and follow-ups. When configured, the API key is sent in an `Authorization: Bearer …` header.

Saved-history management makes no additional network requests and the script provides no cloud sync. Shuiyuan cookies, passwords, and other login credentials are never sent to the LLM. Topic content may still contain personal information; do not use the script for sensitive material that should not be uploaded. Private-message detection is best effort and cannot classify sensitive content in ordinary topics.

## Compatibility and limitations

- Requires a Shuiyuan login, an OpenAI-compatible Chat Completions service, and a userscript manager that permits the configured host.
- The service must accept `model`, `messages`, and `response_format: {"type":"json_object"}`, returning JSON text in `choices[0].message.content`.
- Depends on the current Discourse search and topic JSON structures and may require updates after site changes.
- Results depend on indexing, account permissions, ranking, model decisions, and configured topic and character limits; they are not exhaustive.
- Relevance screening, query expansion, evidence review, and reports can miss useful material or make mistakes. Verify important decisions against the cited topics.
- Automated tests cover storage, history recovery, deletion, and failure handling. A real-browser smoke test is still required for persistence, restored follow-ups, entry styling, keyboard isolation, and custom-host approval.
