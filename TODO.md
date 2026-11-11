# TODO

Ideas for what to build next, roughly in order of value.

## Understand the video itself

- [ ] **Hook analysis.** Look at the first 30 seconds of a video and say how it opens: the promise, the pace, how fast it gets to the point. Needs the transcript or the video. Option: Gemini API, which accepts a public YouTube link directly.
- [ ] **Payoff check.** Does the video deliver what the title and thumbnail promise? Same data source as the hook analysis.
- [ ] **Retention.** Where viewers drop off. Only possible for our own channels, through the YouTube Analytics API (needs sign-in as a channel owner). Not available for competitors.
- [ ] **Transcripts for our own videos**, through the official captions API (also needs channel owner sign-in).
- [ ] **Search inside videos.** Pull frames with ffmpeg, read on-screen text and code with OCR, describe what is shown with computer vision, and combine that with the transcript. Then search for a moment, for example "where do they show the Kibana dashboard". Start with our own videos, where we have the files.

## More channels to learn from

- [ ] **Top developer channels** as a third group in the comparison tab, to learn from creators and not only vendors. Starting list to check: Fireship, ThePrimeagen, Theo (t3.gg), TechWorld with Nana, NetworkChuck, freeCodeCamp, ByteByteGo, Traversy Media, The Coding Train, IBM Technology, Google Cloud Tech, AWS Developers.
- [ ] **Edit the channel list in the app**, instead of in `public/app.js`.
- [ ] **Date filter for the comparison table.** Today it always uses each channel's latest 100 videos.

## Smarter research

- [ ] **Group comment questions by theme with an LLM.** The current filter is rule-based and noisy.
- [ ] **Store everything in Elasticsearch.** Index videos and comments on every search, so past research is kept and searchable.
- [ ] **Semantic search over comments** using `semantic_text`.
- [ ] **Ask questions over the stored comments (RAG)**, with links to the source comments.
- [ ] **Thumbnail search** with Jina multimodal embeddings: find thumbnails by description or by example.
- [ ] **Compare two topics side by side**, for example "observability" against "OpenTelemetry".
- [ ] **Video idea list.** Turn the questions, forum topics and search suggestions into a ranked list of video ideas.

## Make it reusable

- [ ] **Turn it into a Claude skill.** Package the research steps (search, outliers, comments, forum, channel comparison) so Claude can run them from a chat and return a research brief, without opening the app.

## Housekeeping

- [ ] **Test thumbnail analysis** with a real Anthropic API key. It is built but not yet tried end to end.
- [ ] **Export to CSV**: videos and mined questions.
- [ ] **Check the colours** against the Elastic brand guide. They were set from memory.
- [ ] **Better Shorts detection.** Today a Short is any video of 60 seconds or less.
- [ ] **Shared use.** One API key allows about 75 searches a day, so a team version needs saved results or more quota.
