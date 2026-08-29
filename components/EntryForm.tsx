"use client";

import { useState } from "react";

export function EntryForm() {
  const [url, setUrl] = useState("");

  return (
    <form className="entry-form">
      <label htmlFor="play-store-url">Google Play Store app URL</label>
      <div className="input-row">
        <input
          id="play-store-url"
          name="play-store-url"
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://play.google.com/store/apps/details?id=..."
          autoComplete="url"
        />
        <button type="submit">Run audit <span aria-hidden="true">↗</span></button>
      </div>
    </form>
  );
}
