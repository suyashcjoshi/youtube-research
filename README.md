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

## Run it

You need Node.js 18 or newer. There is nothing to install unless you want thumbnail analysis (see below).

1. Get a YouTube Data API v3 key from the [Google Cloud Console](https://console.cloud.google.com/apis/library/youtube.googleapis.com).
2. Create a file named `.env` in this folder:

   ```
   YOUTUBE_API_KEY=your-key-here
   ```

3. Start the app:

   ```bash
   node server.js
   ```

4. Open http://localhost:3456

The forum and Google suggestions work without a key.

### Thumbnail analysis (optional)

This part uses Claude, so it needs an [Anthropic API key](https://console.anthropic.com/) and one install step:

1. Add a second line to `.env`:

   ```
   ANTHROPIC_API_KEY=your-key-here
   ```

2. Install the Anthropic SDK, then restart the app:

   ```bash
   npm install
   ```

Then click **Analyse thumbnails** above any video grid. Each click sends up to 12 thumbnails to Claude and is billed to your Anthropic account.

## Good to know

- The free YouTube quota is 10,000 units a day. One new search costs about 130 units, so you get roughly 75 searches a day. Repeating a search within an hour is free.
- "Shorts" means videos of 60 seconds or less. YouTube does not label Shorts in its API, so this is a best guess.
- The app reads public numbers and comments. It does not watch videos.
- Your API key stays on your machine. `.env` is ignored by git.

## License

MIT. See [LICENSE](LICENSE).
