---
name: connect-ai-instagram
description: Use when querying Instagram data through CData Connect AI. Covers the Instagram Business data model, media and insights tables, comment/reply writes, query patterns, and Instagram-specific conventions. Composes on top of the connect-ai-base skill.
license: MIT
metadata:
  author: CData Software
  version: "1.0"
  connector: Instagram
  family: marketing
---

# CData Connect AI — Instagram Skill

## ⚠️ Prerequisites — load these first
- [ ] connect-ai-base skill

Before proceeding, locate and read the connect-ai-base skill. If it is not available in the current environment (not loaded, not enabled, or not installed), stop immediately. Do not proceed with the task. Tell the user that the connect-ai-base skill is required and ask them to install and enable it before continuing.

This skill provides Instagram-specific guidance for querying Instagram data through CData Connect AI. It composes on top of the `connect-ai-base` skill, which handles the discovery workflow, error recovery, SQL dialect, and query naming convention.

## Precedence

This skill replaces `getInstructions` for the Instagram driver. Do not call `getInstructions` for Instagram — the guidance it provides is already incorporated here. Proceed directly to schema discovery (`getTables` / `getColumns`) after identifying the Instagram connection via `getCatalogs`.

## Schema

Instagram is a single-schema driver. The schema name is `Instagram`.

```sql
SELECT * FROM [YourConnection].[Instagram].[Media] LIMIT 10
```

Replace `[YourConnection]` with your actual Instagram connection name from `getCatalogs`.

## Query Process

Instagram data centers on one business account, its published media, and the engagement/insight metrics for that media. A natural query order:

### Step 1: Identify the account

```sql
SELECT InstagramBusinessAccountId, UserName, FullName, FollowersCount, MediaCount
FROM [YourConnection].[Instagram].[InstagramBusinessProfile]
```

### Step 2: List published media

```sql
SELECT Id, MediaType, MediaProductType, Caption, LikesCount, CommentsCount, Created
FROM [YourConnection].[Instagram].[Media]
ORDER BY Created DESC
LIMIT 10
```

### Step 3: Drill into engagement or performance

Use the media `Id` to read a post's comments, or join to `MediaInsights` for its reach and interaction metrics (see Common Query Patterns).

## Data Model

### Key Tables

- **InstagramBusinessProfile** — Account metadata: username, full name, bio, website, and the follower/follows/media counts. One row per connected business account.
- **Media** — Published media objects (photos, videos, reels, carousels) with caption, like/comment counts, and the `Created` timestamp. The primary "what did this account post" table.
- **IGMedia** — Media at the object level with extra identifiers: `IGId`, `ShortCode`, `PermanentURL`, `ThumbnailUrl`. Use when you need a post's public permalink or short code.
- **Comments** *(writable)* — Top-level comments on media. Read all comments or scope by `MediaId`. Supports Insert (adding a comment).
- **Replies** *(writable)* — Replies threaded under a comment, linked by `CommentId` (with the parent `MediaId`). Supports Insert.
- **MediaInsights** — Per-media performance: `Views`, `Reach`, `TotalInteractions`, `Saved`, `Replies`. Read all media or scope by `MediaId`.
- **AccountInsights** — Account-level performance over time, driven by the `Period` and `MetricType` control columns.
- **AudienceInsights** — Follower demographics, driven by the `AudienceType` and `Timeframe` control columns.
- **Stories** — Story content for the account; returns rows only while stories are currently active.
- **Media-surface insights** — `MediaInsightsPost`, `MediaInsightsPostAlbum`, `MediaInsightsReels`, `MediaInsightsStory`: the `MediaInsights` shape scoped to static posts, carousel albums, reels, and stories respectively.
- **Account breakdown views** — `AccountWithoutBreakdown`, `AccountContactButtonType`, `AccountFollowType`, `AccountMediaProductType`, `AccountTimeSeriesFollowType`, `AccountTimeSeriesMediaProductType`, `AccountTimeSeriesWithoutBreakdown`, `OnlineFollowers`: account insights sliced by a specific breakdown dimension or as a time series.
- **InstagramPages / Pages** — Facebook Pages linked to the Instagram Business account.
- **Permissions** — OAuth permissions the app has been granted (useful for auditing scope).
- **Tags** — Hashtag and tagged-media metadata. Requires elevated permissions; without them, queries return "Application does not have permission for this action".

### Key Relationships

- `Media.Id` = `IGMedia.Id` = `MediaInsights.MediaId` — the media object id ties posts to their identifiers and their insights.
- `Comments.MediaId` → `Media.Id` — comments belong to a media object.
- `Replies.CommentId` → `Comments.Id`, and `Replies.MediaId` → `Media.Id` — replies thread under a comment on a media object.

## Important Columns

### InstagramBusinessProfile
- `InstagramBusinessAccountId` — unique id of the business account (primary key)
- `UserName` / `FullName` — public handle and display name
- `FollowersCount` / `FollowsCount` / `MediaCount` — follower, following, and post totals
- `Bio` / `Website` / `ProfilePictureUrl` — profile detail fields

### Media
- `Id` — media object id (primary key; joins to `MediaInsights.MediaId`)
- `MediaType` — `IMAGE`, `VIDEO`, `CAROUSEL_ALBUM`
- `MediaProductType` — publishing surface: `AD`, `FEED`, `STORY`, `REELS`
- `Caption` — post text
- `LikesCount` / `CommentsCount` — engagement counts
- `Created` — UTC publish timestamp (use for date filters and sorting)

### IGMedia
- `Id` / `IGId` — media object id and the Instagram-native id
- `ShortCode` / `PermanentURL` — compact code and stable public URL
- `MediaType` / `MediaProductType` — content format and surface
- `Timestamp` — UTC creation time

### Comments *(writable)*
- `Id` — comment id (primary key)
- `Text` — comment body (writable)
- `MediaId` — the media the comment belongs to (writable; use to scope reads)
- `Username` / `UserId` — author
- `Likes` / `Hidden` — engagement and moderation state

### Replies *(writable)*
- `Id` — reply id (primary key)
- `Text` — reply body (writable)
- `CommentId` — parent comment (writable)
- `MediaId` — the media the thread belongs to

### MediaInsights
- `MediaId` — the media the metrics belong to (join key)
- `Views` / `Reach` / `TotalInteractions` / `Saved` / `Replies` — performance metrics

### AccountInsights
- `Period` — `day`, `week`, `28 days`, `lifetime`
- `MetricType` — `default` returns `Reach` / `FollowerCount` per `EndTime`; `total_value` returns `Views` with `StartDate` / `EndDate`

### AudienceInsights
- `AudienceType` — breakdown dimension: `city`, `country`, `gender`, `age`, `gender and age`
- `Timeframe` — reporting window: `last_14_days`, `last_30_days`, `last_90_days`, `prev_month`, `this_month`, `this_week`
- `AudienceGroup` / `TotalAudience` — the segment value and its follower count

## Common Query Patterns

### Most recent posts

```sql
SELECT Id, MediaType, MediaProductType, Caption, LikesCount, CommentsCount, Created
FROM [YourConnection].[Instagram].[Media]
WHERE Created >= '2024-01-01'
ORDER BY Created DESC
LIMIT 10
```

### Posts of a specific media type

```sql
SELECT Id, MediaType, MediaProductType, LikesCount
FROM [YourConnection].[Instagram].[Media]
WHERE MediaType = 'VIDEO'
LIMIT 5
```

### Public permalink / short code for posts

```sql
SELECT Id, IGId, MediaType, ShortCode, PermanentURL, Timestamp
FROM [YourConnection].[Instagram].[IGMedia]
LIMIT 5
```

For just a shareable link, `Media` also exposes a `Link` column equivalent to `IGMedia.PermanentURL`, so a "give me the link to this post" question can be answered straight from `Media`. Reach for `IGMedia` when you specifically need `ShortCode` or `IGId`.

### Comments on a specific post

```sql
SELECT Id, Text, Username, Likes, Created
FROM [YourConnection].[Instagram].[Comments]
WHERE MediaId = '<media-id>'
LIMIT 10
```

### Post performance (media joined to insights)

```sql
SELECT m.Id, m.Caption, m.LikesCount, i.Reach, i.TotalInteractions, i.Saved
FROM [YourConnection].[Instagram].[Media] m
JOIN [YourConnection].[Instagram].[MediaInsights] i ON m.Id = i.MediaId
LIMIT 5
```

### Account reach and followers over time

```sql
SELECT EndTime, Reach, FollowerCount
FROM [YourConnection].[Instagram].[AccountInsights]
WHERE Period = 'day'
```

### Cumulative account views

```sql
SELECT StartDate, EndDate, Views, Reach
FROM [YourConnection].[Instagram].[AccountInsights]
WHERE Period = 'day' AND MetricType = 'total_value'
```

### Follower demographics

```sql
SELECT AudienceType, AudienceGroup, TotalAudience
FROM [YourConnection].[Instagram].[AudienceInsights]
WHERE AudienceType = 'age' AND Timeframe = 'this_month'
```

## Write Operations

Instagram supports writes on the `Comments` and `Replies` tables where the connection and the account's permissions allow it. Media, profile, and insight tables are read-only.

### Add a comment to a post

```sql
INSERT INTO [YourConnection].[Instagram].[Comments]
([MediaId], [Text])
VALUES
('<media-id>', 'Thanks for sharing!')
```

### Reply to a comment

```sql
INSERT INTO [YourConnection].[Instagram].[Replies]
([CommentId], [Text])
VALUES
('<comment-id>', 'Appreciate the feedback!')
```

Writing to comments and replies requires the `instagram_manage_comments` permission on the connected app. This surface supports adding rows (INSERT) only — there is no DELETE operation, so comments cannot be removed through Connect AI. If an INSERT is blocked, the Connect AI connection may not have write access enabled — guide the user to their Connect AI connection settings to ensure write access is enabled.

## Instagram-Specific Conventions

- **Start from the profile, then media.** `InstagramBusinessProfile` returns one row for the connected account; `Media` (or `IGMedia` for permalinks) is the entry point for post-level questions.
- **Insight tables need their control column.** `AccountInsights` requires `Period` (`day`, `week`, `28 days`, `lifetime`); `AudienceInsights` is driven by `AudienceType` and `Timeframe`. Supply these rather than expecting free-form filters. `AccountInsights` also switches shape on `MetricType`: `default` yields `Reach`/`FollowerCount` per `EndTime`, `total_value` yields `Views` with `StartDate`/`EndDate`.
- **Demographics need a sizeable audience.** `AudienceInsights` returns no rows for accounts below Instagram's follower threshold (roughly 100 followers). An empty result there is an Instagram platform rule, not a query problem.
- **Stories are ephemeral.** `Stories` returns rows only while stories are currently active; they expire after 24 hours, so an empty result usually means none are live.
- **Join media to insights on `Id = MediaId`.** `Media.Id` and `IGMedia.Id` match `MediaInsights.MediaId`.
- **Scope comments and replies.** Filter `Comments` by `MediaId` to read one post's thread; `Replies` link to a parent `CommentId`.
- **Filter media by explicit dates.** Filter `Media` on `Created` (e.g. `Created >= '2024-01-01'`) and sort with `ORDER BY Created DESC`.
- **Permission errors are scope issues.** `Tags` (and some insight scopes) require additional Instagram permissions. "Application does not have permission for this action" means the connected app lacks the needed scope, not that the query is malformed. On a connection that *has* the scope, an empty `Tags` result just means no matching tagged media — not a failure.
- **Writes are add-only.** `Comments` and `Replies` support INSERT (posting a comment or reply); there is no DELETE on this surface, so comments cannot be removed. Media, profile, and insight tables are read-only — do not attempt to write to them.
