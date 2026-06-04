import https from "https";
import fs from "fs";

const url =
  "https://gist.githubusercontent.com/brainwo/8ea346ff73ace01aa5b7dd23014246e6/raw";

https.get(url, (res) => {
  let d = "";
  res.on("data", (c) => (d += c));
  res.on("end", () => {
    const lines = d.trim().split(/\r?\n/).slice(1);
    const entries = [];
    for (const line of lines) {
      const m = line.match(/^"([^"]+)","([^"]+)"/);
      if (m) entries.push([m[1], m[2]]);
    }
    const aliases = {
      ":face-red:": ":face-red-heart-shape:",
    };
    const body = `/** Auto-generated from brainwo YouTube Live Chat Emoji gist — scripts/gen-youtube-emojis.mjs */
export const YOUTUBE_CHAT_EMOJI_ENTRIES: ReadonlyArray<readonly [string, string]> = ${JSON.stringify(entries, null, 2)} as const;

export const YOUTUBE_CHAT_EMOJI_ALIASES: Readonly<Record<string, string>> = ${JSON.stringify(aliases, null, 2)} as const;
`;
    fs.mkdirSync("src/data", { recursive: true });
    fs.writeFileSync("src/data/youtube-chat-emojis.generated.ts", body);
    console.log("entries", entries.length);
  });
});
