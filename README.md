# Topic Scout

A small local web app to research a topic before you make a video about it.

Type a topic and it shows:

- **Top YouTube videos**, with filters YouTube search does not give you: date range, Shorts or long-form, language, minimum views, maximum channel size.
- **Outlier score** for each video: its views compared with what that channel normally gets. A high score means the topic worked, not just the channel's size.
- **Why did it perform?** A plain breakdown of each video's numbers, title and top comments.
- **Questions from the comments** of the top videos.
- **Elastic forum topics** and **Google search suggestions** for the same topic.

A second tab compares Elastic's channels with competitors (Datadog, Grafana, OpenSearch and others) in one table, and lets you dig into any one channel. To change the list, edit `CHANNELS` in `index.html`.

## Run it

You need Node.js 18 or newer. There is nothing to install.

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

## Good to know

- The free YouTube quota is 10,000 units a day. One new search costs about 130 units, so you get roughly 75 searches a day. Repeating a search within an hour is free.
- "Shorts" means videos of 60 seconds or less. YouTube does not label Shorts in its API, so this is a best guess.
- The app reads public numbers and comments. It does not watch videos.
- Your API key stays on your machine. `.env` is ignored by git.

## License

MIT. See [LICENSE](LICENSE).
