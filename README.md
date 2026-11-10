# YouTube Research - Topic Scout

A small local web app to research a topic before you make a video about it.

Type a topic and it shows:

- **Top YouTube videos**, with filters YouTube search does not give you: date range, Shorts or long-form, language, minimum views, maximum channel size.
- **Outlier score** for each video: its views compared with what that channel normally gets. A high score means the topic worked, not just the channel's size.
- **Why did it perform?** A plain breakdown of each video's numbers, title and top comments.
- **Thumbnail analysis** (optional): Claude looks at the thumbnails on screen and says what the strong performers have in common.
- **Questions from the comments** of the top videos.
- **Elastic forum topics** and **Google search suggestions** for the same topic.

A second tab compares Elastic's channels with competitors (Datadog, Grafana, OpenSearch and others) in one table, and lets you dig into any one channel. To change the list, edit `CHANNELS` in `index.html`.

## Get started

It takes about five minutes. You need [Node.js](https://nodejs.org/) 18 or newer.

### 1. Get the code

```bash
git clone https://github.com/suyashcjoshi/youtube-research.git
cd youtube-research
```

### 2. Create a YouTube API key (free)

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and sign in with a Google account.
2. Click the project menu at the top of the page, then **New Project**. Give it any name and click **Create**.
3. Open the [YouTube Data API v3 page](https://console.cloud.google.com/apis/library/youtube.googleapis.com) and click **Enable**.
4. Go to [Credentials](https://console.cloud.google.com/apis/credentials), click **Create credentials**, then **API key**.
5. Copy the key that appears.

No billing or credit card is needed. Optional but sensible: click the key, and under **API restrictions** limit it to "YouTube Data API v3".

### 3. Add the key

Copy the example file:

```bash
cp .env.example .env
```

Open `.env` in any editor and paste your key after `YOUTUBE_API_KEY=`.

### 4. Run the app

In the project folder, run:

```bash
node server.js
```

You should see `Topic Scout running at http://localhost:3456`. Leave that terminal window open.

### 5. Open it

Go to http://localhost:3456 in your browser, type a topic such as "observability", and click **Research**.

- **To stop the app:** press `Ctrl + C` in the terminal.
- **To run it again later:** `cd` into the folder and run `node server.js`. Steps 1 to 3 are one-time only.
- **No key yet?** The app still starts. The Elastic forum and Google suggestions work without one.

### Optional: bring your own Anthropic key for thumbnail analysis

Everything above works without this. Thumbnail analysis is the only part that uses Claude, so it needs your own Anthropic API key. Unlike the YouTube key, this one is paid: each click costs a few cents, billed to your Anthropic account.

1. Open the [Claude Console](https://console.anthropic.com/) and sign in or create an account.
2. Add credit under **Billing**.
3. Go to **API keys**, click **Create key**, and copy it.
4. Paste it into `.env` after `ANTHROPIC_API_KEY=`.
5. Stop the app (`Ctrl + C`), install the Anthropic SDK, and start it again:

   ```bash
   npm install
   ```

   ```bash
   node server.js
   ```

Then click **Analyse thumbnails** above any video grid. Each click sends up to 12 thumbnails to Claude.

### If something goes wrong

- **"YouTube API key needed"**: the key is missing from `.env`, or `.env` is not in the project folder.
- **"API key not valid"**: check for extra spaces or quotes around the key in `.env`.
- **"YouTube Data API v3 has not been used in project..."**: step 2.3 was skipped. Enable the API and wait a minute.
- **"Daily YouTube quota used up"**: the free quota resets at midnight Pacific time.

## Good to know

- The free YouTube quota is 10,000 units a day. One new search costs about 130 units, so you get roughly 75 searches a day. Repeating a search within an hour is free.
- "Shorts" means videos of 60 seconds or less. YouTube does not label Shorts in its API, so this is a best guess.
- The app reads public numbers and comments. It does not watch videos.
- Your API key stays on your machine. `.env` is ignored by git.

## Limits of the YouTube API

The app can only show what YouTube's public API gives out:

- **Daily quota.** 10,000 free units a day per key. A search is the expensive call (100 units).
- **No transcripts.** Captions can only be downloaded for videos you own.
- **No retention, watch time or click-through rate.** These are private to each channel's owner.
- **No dislike counts**, and some channels hide their subscriber count.
- **No Shorts label.** The app guesses from the video length.
- **Search is not complete.** It returns YouTube's pick of matching videos, 50 at a time, not every video on a topic. The language filter is a preference, not a guarantee.
- **Counts are a little behind** and rounded for subscribers.
- **Comments.** Only public top-level comments, 100 per request, and none when a video has comments turned off.

## What's next

See [TODO.md](TODO.md).

## License

MIT. See [LICENSE](LICENSE).
