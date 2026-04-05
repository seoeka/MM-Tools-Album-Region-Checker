import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import process from "node:process";
import { Buffer } from "node:buffer";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8787;

app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://mm-tools-album-region-checker.vercel.app"
  ]
}));

app.use(express.json());

const REGION_MAP = {
  JP: "JP",
  US: "US",
  ID: "ID",
};

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function parseSpotifyAlbumId(url) {
  if (!url || typeof url !== "string") return null;
  const match = url.match(/album\/([a-zA-Z0-9]+)(\?|$)/);
  return match ? match[1] : null;
}

async function getSpotifyAccessToken() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in environment variables");
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Spotify token error: ${text}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function fetchSpotifyAlbum(albumId, market, token) {
  const response = await fetch(
    `https://api.spotify.com/v1/albums/${albumId}?market=${market}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Spotify album fetch failed for ${market}: ${text}`);
  }

  return response.json();
}

function mapSpotifyTrackStatus(track) {
  if (!track) return "removed";

  const reason = track?.restrictions?.reason;

  if (reason === "product") return "premium";
  if (reason === "market" || track?.is_playable === false) return "unavailable";

  return "playable";
}

function normalizeTrack(track, index) {
  return {
    id: track?.id || `track-${index}`,
    title: track?.name || `Track ${index + 1}`,
    duration: formatDuration(track?.duration_ms || 0),
  };
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/check-album", async (req, res) => {
  try {
    const { provider, url, regions } = req.body;

    if (!provider || !url) {
      return res.status(400).json({
        error: "provider and url are required",
      });
    }

    if (provider === "apple") {
      return res.status(400).json({
        error: "Apple Music check is available on localhost only.",
      });
    }

    if (provider !== "spotify") {
      return res.status(400).json({
        error: "Unsupported provider. Use spotify.",
      });
    }

    const requestedRegions = Array.isArray(regions) && regions.length
      ? regions.filter((code) => REGION_MAP[code])
      : ["JP", "US", "ID"];

    const albumId = parseSpotifyAlbumId(url);

    if (!albumId) {
      return res.status(400).json({
        error: "Invalid Spotify album URL",
      });
    }

    const token = await getSpotifyAccessToken();

    const albumEntries = await Promise.all(
      requestedRegions.map(async (regionCode) => {
        const album = await fetchSpotifyAlbum(albumId, REGION_MAP[regionCode], token);
        return [regionCode, album];
      })
    );

    const albumByRegion = Object.fromEntries(albumEntries);

    const baseRegion = requestedRegions[0];
    const baseAlbum = albumByRegion[baseRegion];
    const baseTracks = baseAlbum?.tracks?.items || [];

    const tracks = baseTracks.map((baseTrack, index) => {
      const normalized = normalizeTrack(baseTrack, index);
      const statuses = {};

      for (const regionCode of requestedRegions) {
        const regionalTrack = albumByRegion[regionCode]?.tracks?.items?.[index] || null;
        statuses[regionCode] = mapSpotifyTrackStatus(regionalTrack);
      }

      return {
        ...normalized,
        statuses,
      };
    });

    return res.json({
      album: {
        id: baseAlbum?.id || albumId,
        title: baseAlbum?.name || "Unknown Album",
        artist:
          baseAlbum?.artists?.map((artist) => artist.name).join(", ") || "Unknown Artist",
        image: baseAlbum?.images?.[0]?.url || null,
        provider: "spotify",
      },
      tracks,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: error.message || "Internal server error",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Spotify-only server running on http://127.0.0.1:${PORT}`);
});