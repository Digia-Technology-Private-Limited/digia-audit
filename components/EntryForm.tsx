"use client";

import { useState } from "react";
import { getPlayStoreUrlError, validatePlayStoreUrl } from "../lib/validation";

export function EntryForm() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const result = validatePlayStoreUrl(url);

    if (!result.valid) {
      setError(getPlayStoreUrlError(result.reason));
      return;
    }

    setError(null);
  }

  return (
    <form className="entry-form" onSubmit={handleSubmit} noValidate>
      <label htmlFor="play-store-url">Google Play Store app URL</label>
      <div className="input-row">
        <input
          id="play-store-url"
          name="play-store-url"
          type="url"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            if (error) setError(null);
          }}
          placeholder="https://play.google.com/store/apps/details?id=..."
          autoComplete="url"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "play-store-url-error" : undefined}
        />
        <button type="submit">Run audit <span aria-hidden="true">↗</span></button>
      </div>
      {error ? <p className="form-error" id="play-store-url-error" role="alert">{error}</p> : null}
    </form>
  );
}
