import { useMemo, useState } from "react";

const REGION_META = {
  JP: {
    label: "Japan",
    flagUrl: "https://flagcdn.com/w40/jp.png",
  },
  US: {
    label: "United States",
    flagUrl: "https://flagcdn.com/w40/us.png",
  },
  ID: {
    label: "Indonesia",
    flagUrl: "https://flagcdn.com/w40/id.png",
  },
};

const THEMES = {
  light: {
    bg: "#f6f8fb",
    panel: "#ffffff",
    panelSoft: "#f8fafc",
    text: "#0f172a",
    subtext: "#475569",
    border: "#e2e8f0",
    inputBg: "#ffffff",
    chipBg: "#f1f5f9",
    shadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
  },
  dark: {
    bg: "#0b1220",
    panel: "#111827",
    panelSoft: "#172033",
    text: "#f8fafc",
    subtext: "#94a3b8",
    border: "#243041",
    inputBg: "#0f172a",
    chipBg: "#1e293b",
    shadow: "0 10px 30px rgba(0, 0, 0, 0.35)",
  },
};

const STATUS_META = {
  playable: {
    label: "Available",
    color: "#22c55e",
    soft: "rgba(34, 197, 94, 0.12)",
  },
  premium: {
    label: "Premium",
    color: "#22c55e",
    soft: "rgba(34, 197, 94, 0.12)",
  },
  removed: {
    label: "Removed",
    color: "#64748b",
    soft: "rgba(100, 116, 139, 0.12)",
  },
  unavailable: {
    label: "Unavailable",
    color: "#64748b",
    soft: "rgba(100, 116, 139, 0.12)",
  },
};

function getMainStatus(statuses) {
  const values = Object.values(statuses);
  if (values.every((v) => v === "playable")) return "playable";
  if (values.includes("removed")) return "removed";
  if (values.includes("premium")) return "premium";
  return "unavailable";
}

function getRegionDisplay(provider, regionStatus) {
  if (provider === "apple") {
    const isAvailable = regionStatus === "playable";

    return {
      label: isAvailable ? "Available" : "Unavailable",
      color: isAvailable ? "#22c55e" : "#64748b",
      soft: isAvailable
        ? "rgba(34, 197, 94, 0.12)"
        : "rgba(100, 116, 139, 0.12)",
    };
  }

  return STATUS_META[regionStatus] || STATUS_META.unavailable;
}

function getProviderConfig(provider) {
  if (provider === "spotify") {
    return {
      name: "Spotify",
      accent: "#1db954",
      placeholder: "Paste Spotify album link...",
      helper: "Example: https://open.spotify.com/album/...",
    };
  }

  return {
    name: "Apple Music",
    accent: "#fc3c44",
    placeholder: "Paste Apple Music album link...",
    helper: "Example: https://music.apple.com/.../album/...",
  };
}

function StatCard({ label, value, theme }) {
  return (
    <div
      style={{
        background: theme.panelSoft,
        border: `1px solid ${theme.border}`,
        borderRadius: 16,
        padding: 14,
      }}
    >
      <div style={{ fontSize: 13, color: theme.subtext, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: theme.text }}>
        {value}
      </div>
    </div>
  );
}

export default function App() {
  const [provider, setProvider] = useState("spotify");
  const [url, setUrl] = useState("");
  const [themeMode, setThemeMode] = useState("dark");
  const [loading, setLoading] = useState(false);

  const [resultsByProvider, setResultsByProvider] = useState({
    spotify: {
      albumInfo: null,
      tracks: [],
      error: "",
    },
    apple: {
      albumInfo: null,
      tracks: [],
      error: "",
    },
  });

  const theme = THEMES[themeMode];
  const currentResult = resultsByProvider[provider];
  const albumInfo = currentResult.albumInfo;
  const tracks = currentResult.tracks;
  const error = currentResult.error;
  const providerConfig = getProviderConfig(provider);
  const sourceTracks = tracks;

  const summary = useMemo(() => {
    const total = sourceTracks.length;

    if (provider === "apple") {
      const jpAvailable = sourceTracks.filter(
        (track) => track.statuses?.JP === "playable"
      ).length;

      const usAvailable = sourceTracks.filter(
        (track) => track.statuses?.US === "playable"
      ).length;

      const idAvailable = sourceTracks.filter(
        (track) => track.statuses?.ID === "playable"
      ).length;

      return {
        total,
        jpAvailable,
        usAvailable,
        idAvailable,
      };
    }

    const playable = sourceTracks.filter(
      (track) => getMainStatus(track.statuses) === "playable"
    ).length;
    const premium = sourceTracks.filter(
      (track) => getMainStatus(track.statuses) === "premium"
    ).length;
    const removed = sourceTracks.filter(
      (track) => getMainStatus(track.statuses) === "removed"
    ).length;
    const unavailable = sourceTracks.filter(
      (track) => getMainStatus(track.statuses) === "unavailable"
    ).length;

    return { total, playable, premium, removed, unavailable };
  }, [sourceTracks, provider]);

  function handleProviderChange(nextProvider) {
    setProvider(nextProvider);
    setUrl("");
    setLoading(false);
    setResultsByProvider({
      spotify: { albumInfo: null, tracks: [], error: "" },
      apple: { albumInfo: null, tracks: [], error: "" },
    });
  }

  async function handleCheckAlbum() {
    try {
      setLoading(true);

      setResultsByProvider((prev) => ({
        ...prev,
        [provider]: {
          ...prev[provider],
          error: "",
        },
      }));

      const isLocal =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1";

      const API_URL = isLocal ? "http://127.0.0.1:8787" : "";

      const response = await fetch(`${API_URL}/api/check-album`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: provider.toLowerCase(),
          url,
          regions: ["JP", "US", "ID"],
        }),
      });

      const text = await response.text();

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Server returned non-JSON response: ${text.slice(0, 120)}`);
      }

      if (!response.ok) {
        throw new Error(data.error || "Failed to check album");
      }
      setResultsByProvider((prev) => ({
        ...prev,
        [provider]: {
          albumInfo: data.album || null,
          tracks: data.tracks || [],
          error: "",
        },
      }));
    } catch (err) {
      setResultsByProvider((prev) => ({
        ...prev,
        [provider]: {
          ...prev[provider],
          error: err.message || "Something went wrong",
        },
      }));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: theme.bg,
        color: theme.text,
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        transition: "all 0.2s ease",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "1240px",
          margin: "0 auto",
          padding: window.innerWidth < 640 ? 14 : 24,
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 16,
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: 20,
          }}
        >
        <div
          style={{
            display: "flex",
            width: "100%",
            flexDirection: "column",
            gap: 14,
            marginBottom: 20,
          }}
        >
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={() =>
                setThemeMode((prev) => (prev === "dark" ? "light" : "dark"))
              }
              style={{
                border: `1px solid ${theme.border}`,
                background: theme.panel,
                color: theme.text,
                padding: "10px 14px",
                borderRadius: 12,
                cursor: "pointer",
                boxShadow: theme.shadow,
                fontWeight: 600,
              }}
            >
              {themeMode === "dark" ? "☀️ Light Mode" : "🌙 Dark Mode"}
            </button>
          </div>

          <div style={{textAlign: "center"}}>
            <h1
              style={{
                margin: 0,
                fontSize: 36,
                fontWeight: 800,
                lineHeight: 1.22,
                color: theme.text,
                marginBottom: 10,
              }}
            >
              🎵 Album Region Checker
            </h1>

            <p
              style={{
                margin: 0,
                color: theme.subtext,
                lineHeight: 1.6,
                fontSize: 18,
              }}
            >
              Check album tracks availability in JP / US / ID for Spotify and Apple Music.
            </p>
          </div>
        </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          <div
            style={{
              background: theme.panel,
              border: `1px solid ${theme.border}`,
              borderRadius: 24,
              padding: 24,
              boxShadow: theme.shadow,
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 10,
                marginBottom: 18,
              }}
            >
              <button
                onClick={() => handleProviderChange("spotify")}
                style={{
                  flex: 1,
                  padding: "13px 14px",
                  borderRadius: 14,
                  border:
                    provider === "spotify"
                      ? "2px solid #1db954"
                      : `1px solid ${theme.border}`,
                  background:
                    provider === "spotify"
                      ? "#1db954"
                      : theme.panelSoft,
                  color:
                    provider === "spotify"
                      ? "#ffffff"
                      : theme.text,
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 16,
                  transition: "all 0.2s ease",
                }}
              >
                Spotify
              </button>

              <button
                onClick={() => handleProviderChange("apple")}
                style={{
                  flex: 1,
                  padding: "13px 14px",
                  borderRadius: 14,
                  border:
                    provider === "apple"
                      ? "2px solid #fc3c44"
                      : `1px solid ${theme.border}`,
                  background:
                    provider === "apple"
                      ? "#fc3c44"
                      : theme.panelSoft,
                  color:
                    provider === "apple"
                      ? "#ffffff"
                      : theme.text,
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 16,
                  transition: "all 0.2s ease",
                }}
              >
                Apple Music
              </button>
            </div>

            <div
              style={{
                borderRadius: 18,
                padding: "24px 20px",
                marginBottom: 18,
                background:
                  provider === "spotify"
                    ? "linear-gradient(135deg, rgba(29,185,84,0.18), rgba(29,185,84,0.05))"
                    : "linear-gradient(135deg, rgba(252,60,68,0.18), rgba(252,60,68,0.05))",
                border: `1px solid ${theme.border}`,
              }}
            >

              <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.2, marginBottom: 4 }}>
                {providerConfig.name} Album Checker
              </div>
              <div style={{ color: theme.subtext, fontSize: 14 }}>
                Paste an album link to check each track status by region.
              </div>
            </div>

            <label
              style={{
                display: "block",
                fontSize: 16,
                fontWeight: 700,
                marginBottom: 8,
              }}
            >
              Album Link
            </label>

            <input
              style={{
                width: "100%",
                padding: "14px 16px",
                borderRadius: 14,
                border: `1px solid ${theme.border}`,
                background: theme.inputBg,
                color: theme.text,
                outline: "none",
                fontSize: 16,
                boxSizing: "border-box",
              }}
              placeholder={providerConfig.placeholder}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />

            <div
              style={{
                fontSize: 13,
                color: theme.subtext,
                marginTop: 8,
                marginBottom: 14,
              }}
            >
              {providerConfig.helper}
            </div>

            <button
              onClick={handleCheckAlbum}
              disabled={loading}
              style={{
                width: "100%",
                marginTop: 4,
                padding: "14px 16px",
                borderRadius: 14,
                border: "none",
                background: providerConfig.accent,
                color: "white",
                cursor: loading ? "not-allowed" : "pointer",
                fontWeight: 700,
                fontSize: 15,
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? "Checking..." : "Check Album"}
            </button>

            {loading ? (
              <div
                style={{
                  marginTop: 14,
                  padding: 14,
                  borderRadius: 14,
                  border: `1px solid ${theme.border}`,
                  background: theme.panelSoft,
                  color: theme.subtext,
                  fontSize: 16,
                  fontWeight: 600,
                  lineHeight: 1.5,
                }}
              >
                {provider === "apple"
                  ? "Checking Apple Music regions... this can take a few seconds."
                  : "Checking Spotify album..."}
              </div>
            ) : null}

            {error ? (
              <div
                style={{
                  marginTop: 12,
                  color: "#ef4444",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {error}
              </div>
            ) : null}
          </div>

          {albumInfo ? (
            <div
              style={{
                display: "flex",
                gap: 24,
                alignItems: "center",
                background: theme.panel,
                border: `1px solid ${theme.border}`,
                borderRadius: 24,
                padding: "16px 24px",
                boxShadow: theme.shadow,
                minHeight: 200,
                flexWrap: "wrap",
              }}
            >
              {albumInfo.image ? (
                <div
                  style={{
                    width: 180,
                    height: 180,
                    minWidth: 180,
                    borderRadius: 22,
                    overflow: "hidden",
                    flexShrink: 0,
                  }}
                >
                  <img
                    src={albumInfo.image}
                    alt={albumInfo.title}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                </div>
              ) : null}

              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 32,
                    fontWeight: 800,
                    color: theme.text,
                    lineHeight: 1.15,
                    marginBottom: 10,
                    wordBreak: "break-word",
                  }}
                >
                  {albumInfo.title}
                </div>

                <div
                  style={{
                    fontSize: 18,
                    color: theme.subtext,
                    lineHeight: 1.5,
                    wordBreak: "break-word",
                  }}
                >
                  {albumInfo.artist || "Unknown Artist"}
                </div>
              </div>
            </div>
          ) : null}

          <div
            style={{
              background: theme.panel,
              border: `1px solid ${theme.border}`,
              borderRadius: 24,
              padding: 24,
              boxShadow: theme.shadow,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                gap: 10,
              }}
            >
              {provider === "apple" ? (
                <>
                  <StatCard label="Tracks" value={summary.total} theme={theme} />
                  <StatCard label="JP Available" value={summary.jpAvailable} theme={theme} />
                  <StatCard label="US Available" value={summary.usAvailable} theme={theme} />
                  <StatCard label="ID Available" value={summary.idAvailable} theme={theme} />
                </>
              ) : (
                <>
                  <StatCard label="Tracks" value={summary.total} theme={theme} />
                  <StatCard label="Playable" value={summary.playable} theme={theme} />
                  <StatCard label="Premium" value={summary.premium} theme={theme} />
                  <StatCard label="Removed" value={summary.removed} theme={theme} />
                  <StatCard label="Unavailable" value={summary.unavailable} theme={theme} />
                </>
              )}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {sourceTracks.map((track, index) => {
              return (
                <div
                  key={track.id}
                  style={{
                    border: `1px solid ${theme.border}`,
                    background: theme.panel,
                    padding: 16,
                    borderRadius: 18,
                    boxShadow: theme.shadow,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                      marginBottom: 14,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 20,
                          fontWeight: 800,
                          color: theme.text,
                        }}
                      >
                        {index + 1}. {track.title} <span style={{ fontWeight: 600, color: theme.subtext }}>({track.duration})</span>
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                      gap: 12,
                    }}
                  >
                  {Object.entries(REGION_META).map(([code, region]) => {
                    const regionStatus = track.statuses[code];
                    const displayMeta = getRegionDisplay(provider, regionStatus);

                    return (
                      <div
                        key={code}
                        style={{
                          background: displayMeta.soft,
                          border: `1px solid ${displayMeta.color}`,
                          borderRadius: 12,
                          padding: "10px 12px",
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          minHeight: 58,
                        }}
                      >
                        <img
                          src={region.flagUrl}
                          alt={region.label}
                          style={{
                            width: 34,
                            height: 24,
                            objectFit: "cover",
                            borderRadius: 4,
                            border: `1px solid ${theme.border}`,
                            display: "block",
                            flexShrink: 0,
                          }}
                        />

                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                            minWidth: 0,
                          }}
                        >
                          <div
                            style={{
                              color: displayMeta.color,
                              fontWeight: 800,
                              fontSize: 13,
                              lineHeight: 1.2,
                            }}
                          >
                            {displayMeta.label}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}