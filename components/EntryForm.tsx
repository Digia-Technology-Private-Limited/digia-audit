"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "../convex/_generated/api";
import { getPlayStoreUrlError, validatePlayStoreUrl } from "../lib/validation";

export function EntryForm() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const createAudit = useMutation(api.audits.create);
  const [isStarting, setIsStarting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const result = validatePlayStoreUrl(url);

    if (!result.valid) {
      setError(getPlayStoreUrlError(result.reason));
      return;
    }

    setError(null);
    setIsStarting(true);

    try {
      const auditId = await createAudit({ sourceUrl: url.trim(), packageId: result.packageId });
      router.push(`/audits/${auditId}`);
    } catch {
      setError("The audit could not be started. Please try again.");
      setIsStarting(false);
    }
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
        <button type="submit" disabled={isStarting}>
          {isStarting ? "Starting…" : "Run audit"} <span aria-hidden="true">↗</span>
        </button>
      </div>
      {error ? <p className="form-error" id="play-store-url-error" role="alert">{error}</p> : null}
    </form>
  );
}
